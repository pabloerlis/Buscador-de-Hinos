package br.com.buscadordehinos.app;

import android.app.Activity;
import android.content.Intent;
import android.content.res.Configuration;
import android.database.Cursor;
import android.provider.OpenableColumns;
import android.os.ParcelFileDescriptor;
import android.content.SharedPreferences;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.Locale;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.webkit.JavascriptInterface;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.view.View;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import org.json.JSONObject;

public final class MainActivity extends Activity {
    private static final String HOST = "https://appassets.androidplatform.net";
    private static final String DATA_URL = "https://raw.githubusercontent.com/italozaina/projection-html5-icm/master/data/data.json";
    private static final int MAX_JSON_BYTES = 12_000_000;
    private static final int PICK_FILE = 1205;
    private static final int PICK_GGUF = 1206;
    private static final String PREFS = "hinos_local_llm";
    private static final String MODEL_URI_KEY = "model_uri";
    private final ExecutorService llmExecutor=Executors.newSingleThreadExecutor();
    private volatile boolean modelLoaded=false;
    private volatile boolean llmBusy=false;
    private volatile String modelPhase="none";
    private volatile String modelError="";
    private volatile long lastDurationMs=0;
    private volatile long generationStarted=0;
    private volatile String selectedName="";
    private ParcelFileDescriptor modelDescriptor;
    private static final boolean NATIVE_AVAILABLE;
    static {
        boolean available;
        try { System.loadLibrary("hinosllm"); available=true; }
        catch(Throwable error) { available=false; }
        NATIVE_AVAILABLE=available;
    }
    private static native String nativeLoad(String path);
    private static native int nativeLoadProgress();
    private static native String nativeGenerate(String prompt,int maxTokens);
    private static native void nativeUnload();
    private WebView web;
    private ValueCallback<Uri[]> pendingFile;

    @Override public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        getWindow().setStatusBarColor(Color.rgb(21,72,62));
        getWindow().setNavigationBarColor(Color.rgb(250,250,248));
        web = new WebView(this);
        setContentView(web);
        WebSettings settings = web.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(true);
        settings.setJavaScriptCanOpenWindowsAutomatically(false);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        if (Build.VERSION.SDK_INT >= 26) settings.setSafeBrowsingEnabled(true);
        web.setWebViewClient(new WebViewClient() {
            @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                return !HOST.equals(request.getUrl().getScheme() + "://" + request.getUrl().getHost());
            }
            @Override public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                String url=request.getUrl().toString();
                String path=request.getUrl().getPath();
                if (!"https".equals(request.getUrl().getScheme()) || !"appassets.androidplatform.net".equals(request.getUrl().getHost())) return null;
                if (path == null) return forbidden();
                if ("/import/data.json".equals(path)) {
                    File data = new File(getFilesDir(), "colecao.json");
                    if (!data.isFile()) return forbidden();
                    try { return new WebResourceResponse("application/json", "UTF-8", new FileInputStream(data)); }
                    catch (IOException ex) { return forbidden(); }
                }
                if (!path.startsWith("/assets/") || path.contains("..") || path.contains("\\")) return forbidden();
                String file=path.substring("/assets/".length());
                if (file.isEmpty()) file="index.html";
                try {
                    return new WebResourceResponse(mimeType(file), "UTF-8", getAssets().open(file));
                } catch (IOException ex) { return forbidden(); }
            }
        });
        web.setWebChromeClient(new WebChromeClient(){
            @Override public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback, FileChooserParams params){
                if (pendingFile != null) pendingFile.onReceiveValue(null);
                pendingFile=callback;
                try { startActivityForResult(params.createIntent(),PICK_FILE); return true; }
                catch (Exception ex) { pendingFile.onReceiveValue(null);pendingFile=null;return false; }
            }
        });
        web.addJavascriptInterface(new ImportBridge(), "NativeHinos");
        web.addJavascriptInterface(new ModelBridge(), "NativeGGUF");
        web.loadUrl(HOST + "/assets/index.html");
    }
    private static WebResourceResponse forbidden(){
        return new WebResourceResponse("text/plain", "UTF-8", new java.io.ByteArrayInputStream(new byte[0]));
    }
    private static String mimeType(String file){
        if(file.endsWith(".html"))return "text/html";
        if(file.endsWith(".js"))return "application/javascript";
        if(file.endsWith(".css"))return "text/css";
        if(file.endsWith(".json")||file.endsWith(".webmanifest"))return "application/json";
        if(file.endsWith(".svg"))return "image/svg+xml";
        if(file.endsWith(".png"))return "image/png";
        return "application/octet-stream";
    }
    @Override protected void onActivityResult(int requestCode,int resultCode,Intent data){
        super.onActivityResult(requestCode,resultCode,data);
        if(requestCode==PICK_FILE && pendingFile!=null){
            pendingFile.onReceiveValue(WebChromeClient.FileChooserParams.parseResult(resultCode,data));
            pendingFile=null;
        }
        if(requestCode==PICK_GGUF){
            if(resultCode!=RESULT_OK || data==null || data.getData()==null){
                ggufEvent("selection", false, "Seleção cancelada.");return;
            }
            Uri uri=data.getData();
            try {
                String name=modelName(uri);
                if(!name.toLowerCase(Locale.ROOT).endsWith(".gguf"))throw new IOException("Selecione um arquivo com extensão .gguf.");
                try(InputStream input=getContentResolver().openInputStream(uri)) {
                    if(input==null||input.read()!='G'||input.read()!='G'||input.read()!='U'||input.read()!='F')
                        throw new IOException("Arquivo inválido: cabeçalho GGUF não encontrado.");
                }
                try {getContentResolver().takePersistableUriPermission(uri, Intent.FLAG_GRANT_READ_URI_PERMISSION);}
                catch(SecurityException ignored) { /* Algumas fontes não oferecem permissão persistente. */ }
                // Somente a seleção é persistida. O modelo deve ser carregado explicitamente.
                getSharedPreferences(PREFS,MODE_PRIVATE).edit().putString(MODEL_URI_KEY,uri.toString()).apply();
                selectedName=name;
                modelError="";
                modelPhase="selected";
                if(modelLoaded){
                    llmBusy=true;
                    llmExecutor.execute(()->{
                        try{
                            if(NATIVE_AVAILABLE)nativeUnload();
                            modelLoaded=false;
                            if(modelDescriptor!=null){modelDescriptor.close();modelDescriptor=null;}
                        }catch(Exception ignored){}
                        finally{llmBusy=false;ggufEvent("selection",true,name);}
                    });
                }else ggufEvent("selection",true,name);
            }catch(Exception ex){modelPhase="error";modelError=errorMessage(ex);ggufEvent("selection",false,errorMessage(ex));}
        }
    }
    @Override public void onBackPressed(){
        web.evaluateJavascript("(function(){var layer=document.querySelector('.modal-layer:not(.hidden)');if(layer){var close=layer.querySelector('[data-close]');if(close)close.click();return true;}return false;})()", value -> {
            if (!"true".equals(value)) MainActivity.super.onBackPressed();
        });
    }
    @Override protected void onDestroy(){
        if(pendingFile!=null)pendingFile.onReceiveValue(null);
        if(web!=null){web.removeJavascriptInterface("NativeHinos");web.removeJavascriptInterface("NativeGGUF");web.destroy();web=null;}
        llmExecutor.execute(()->{if(NATIVE_AVAILABLE)nativeUnload();if(modelDescriptor!=null){try{modelDescriptor.close();}catch(IOException ignored){}}});
        llmExecutor.shutdown();
        super.onDestroy();
    }
    private String modelName(Uri uri) {
        try(Cursor cursor=getContentResolver().query(uri,null,null,null,null)) {
            if(cursor!=null&&cursor.moveToFirst()){
                int col=cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME);
                if(col>=0&&!cursor.isNull(col))return cursor.getString(col);
            }
        }catch(Exception ignored){}
        return uri.getLastPathSegment()==null?"modelo.gguf":uri.getLastPathSegment();
    }
    private long modelSize(Uri uri){
        try(Cursor cursor=getContentResolver().query(uri,null,null,null,null)){
            if(cursor!=null&&cursor.moveToFirst()){
                int col=cursor.getColumnIndex(OpenableColumns.SIZE);
                if(col>=0&&!cursor.isNull(col))return cursor.getLong(col);
            }
        }catch(Exception ignored){}
        return -1;
    }
    private static String errorMessage(Throwable ex){return ex.getMessage()==null?ex.getClass().getSimpleName():ex.getMessage();}
    private void ggufEvent(String event,boolean ok,String value){
        String js="window.__ggufNativeEvent && window.__ggufNativeEvent("+JSONObject.quote(event)+","+ok+","+JSONObject.quote(value)+");";
        runOnUiThread(()->{if(web!=null)web.evaluateJavascript(js,null);});
    }
    public class ModelBridge {
        @JavascriptInterface public String status(){
            try{
                String uriString=getSharedPreferences(PREFS,MODE_PRIVATE).getString(MODEL_URI_KEY,null);
                JSONObject result=new JSONObject();
                result.put("available",NATIVE_AVAILABLE);
                result.put("selected",uriString!=null);
                result.put("loaded",modelLoaded);
                result.put("busy",llmBusy);
                result.put("name",uriString!=null?(selectedName.isEmpty()?modelName(Uri.parse(uriString)):selectedName):"");
                result.put("phase",!NATIVE_AVAILABLE?"unavailable":modelPhase);
                result.put("progress",llmBusy&&"loading".equals(modelPhase)?nativeLoadProgress():0);
                result.put("lastError",modelError);
                result.put("lastDurationMs",lastDurationMs);
                if(uriString!=null){
                    long fileSize=modelSize(Uri.parse(uriString));
                    if(fileSize>0)result.put("modelMB",Math.round(fileSize/1048576.0));
                }
                android.app.ActivityManager.MemoryInfo mi=new android.app.ActivityManager.MemoryInfo();
                ((android.app.ActivityManager)getSystemService(ACTIVITY_SERVICE)).getMemoryInfo(mi);
                result.put("availableMB",Math.round(mi.availMem/1048576.0));
                result.put("totalMB",Math.round(mi.totalMem/1048576.0));
                result.put("lowMemory",mi.lowMemory);
                result.put("nativeMB",Math.round(android.os.Debug.getNativeHeapAllocatedSize()/1048576.0));
                return result.toString();
            }catch(Exception error){return "{}";}
        }
        @JavascriptInterface public void selectModel(){
            runOnUiThread(()->{
                if(llmBusy){ggufEvent("selection",false,"Aguarde o processamento em andamento.");return;}
                Intent intent=new Intent(Intent.ACTION_OPEN_DOCUMENT);
                intent.addCategory(Intent.CATEGORY_OPENABLE);
                intent.setType("*/*");
                intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION|Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION);
                try {startActivityForResult(intent,PICK_GGUF);}
                catch(Exception ex){ggufEvent("selection",false,errorMessage(ex));}
            });
        }
        @JavascriptInterface public void loadModel(){
            if(!NATIVE_AVAILABLE){modelPhase="unavailable";ggufEvent("load",false,"Motor nativo indisponível neste dispositivo ARM64.");return;}
            if(llmBusy){ggufEvent("load",false,"A IA já está ocupada.");return;}
            llmBusy=true;modelPhase="loading";modelError="";lastDurationMs=0;
            final long start=android.os.SystemClock.elapsedRealtime();
            ggufEvent("phase",true,"Carregando GGUF…");
            llmExecutor.execute(()->{
                try{
                    String uriString=getSharedPreferences(PREFS,MODE_PRIVATE).getString(MODEL_URI_KEY,null);
                    if(uriString==null)throw new IOException("Selecione um GGUF primeiro.");
                    Uri uri=Uri.parse(uriString);
                    long size=modelSize(uri);
                    android.app.ActivityManager.MemoryInfo memory=new android.app.ActivityManager.MemoryInfo();
                    ((android.app.ActivityManager)getSystemService(ACTIVITY_SERVICE)).getMemoryInfo(memory);
                    // A RAM livre não é toda utilizável pelo processo Android, mesmo que pareça suficiente.
                    // Não rejeitar modelos com base apenas no tamanho do GGUF: mmap é paginado pelo sistema.
                    if(size>0&&size>memory.totalMem*1.2)
                        throw new IOException("Arquivo muito maior que a RAM física. Tente uma quantização menor.");
                    if(modelLoaded){nativeUnload();modelLoaded=false;}
                    if(modelDescriptor!=null){modelDescriptor.close();modelDescriptor=null;}
                    modelDescriptor=getContentResolver().openFileDescriptor(uri,"r");
                    if(modelDescriptor==null)throw new IOException("O Android não disponibilizou o arquivo selecionado.");
                    // Verifica acesso aleatório. Alguns provedores virtuais disponibilizam somente um pipe.
                    try {android.system.Os.lseek(modelDescriptor.getFileDescriptor(),0,android.system.OsConstants.SEEK_CUR);}
                    catch(android.system.ErrnoException ex){
                        throw new IOException("Esse provedor não permite leitura aleatória do GGUF. Salve o arquivo em Downloads do telefone e selecione-o novamente.");
                    }
                    String message=nativeLoad("/proc/self/fd/"+modelDescriptor.getFd());
                    modelLoaded=true;modelPhase="ready";modelError="";
                    lastDurationMs=android.os.SystemClock.elapsedRealtime()-start;
                    ggufEvent("load",true,message);
                }catch(Throwable ex){
                    modelLoaded=false;modelPhase="error";modelError=errorMessage(ex);
                    if(modelDescriptor!=null){try{modelDescriptor.close();}catch(IOException ignored){}modelDescriptor=null;}
                    ggufEvent("load",false,modelError);
                }finally{llmBusy=false;}
            });
        }
        @JavascriptInterface public void generate(String prompt){
            if(llmBusy){ggufEvent("generate",false,"O modelo já está em uso.");return;}
            if(!NATIVE_AVAILABLE||!modelLoaded){ggufEvent("generate",false,"Carregue um GGUF primeiro.");return;}
            if(prompt==null||prompt.trim().isEmpty()||prompt.length()>2400){ggufEvent("generate",false,"Consulta inválida ou longa demais.");return;}
            llmBusy=true;modelPhase="generating";modelError="";
            final long start=android.os.SystemClock.elapsedRealtime();
            ggufEvent("phase",true,"Interpretando contexto…");
            llmExecutor.execute(()->{
                try {
                    String output=nativeGenerate(prompt,152);
                    lastDurationMs=android.os.SystemClock.elapsedRealtime()-start;
                    modelPhase="ready";ggufEvent("generate",true,output);
                }catch(Throwable ex){modelPhase="error";modelError=errorMessage(ex);ggufEvent("generate",false,modelError);}
                finally{llmBusy=false;}
            });
        }
    }

    public class ImportBridge {
        @JavascriptInterface public void downloadCollection(){
            new Thread(()->{
                HttpURLConnection connection=null;
                File temp=null;
                try {
                    URL url = new URL(DATA_URL);
                    connection=(HttpURLConnection) url.openConnection();
                    connection.setConnectTimeout(12000);
                    connection.setReadTimeout(25000);
                    connection.setInstanceFollowRedirects(false);
                    connection.setRequestProperty("Accept", "application/json");
                    if (connection.getResponseCode()!=200) throw new IOException("HTTP "+connection.getResponseCode());
                    temp=new File(getFilesDir(),"colecao.tmp");
                    int total=0;
                    try(InputStream input=connection.getInputStream();FileOutputStream output=new FileOutputStream(temp)){
                        byte[] buffer=new byte[32768];int count;
                        while((count=input.read(buffer))!=-1){
                            total+=count;if(total>MAX_JSON_BYTES)throw new IOException("Coletânea maior que o limite de 12 MB");
                            output.write(buffer,0,count);
                        }
                    }
                    if(total==0)throw new IOException("Arquivo JSON vazio");
                    File dest=new File(getFilesDir(),"colecao.json");
                    if(dest.exists()&&!dest.delete())throw new IOException("Não foi possível substituir a base");
                    if(!temp.renameTo(dest))throw new IOException("Não foi possível salvar a base");
                    result(true,"");
                }catch(Exception ex){
                    if(temp!=null)temp.delete();result(false,ex.getMessage()==null?"Falha de conexão":ex.getMessage());
                }finally { if(connection!=null)connection.disconnect(); }
            },"download-coletanea").start();
        }
        private void result(boolean ok,String error){
            if (web==null)return;
            String javascript="if(window.__hinosDownloadCompleted){window.__hinosDownloadCompleted("+ok+","+JSONObject.quote(error)+");}";
            runOnUiThread(()->{if(web!=null)web.evaluateJavascript(javascript,null);});
        }
    }
}
