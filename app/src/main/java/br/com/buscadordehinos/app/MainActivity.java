package br.com.buscadordehinos.app;

import android.app.Activity;
import android.content.Intent;
import android.content.res.Configuration;
import android.database.Cursor;
import android.provider.OpenableColumns;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.security.MessageDigest;
import android.os.StatFs;
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
    private static final String MODEL_DISPLAY_NAME_KEY = "model_display_name";
    private static final String MODEL_BYTES_KEY = "model_bytes";
    private final ExecutorService llmExecutor=Executors.newSingleThreadExecutor();
    private final ExecutorService vectorExecutor=Executors.newSingleThreadExecutor();
    private volatile String vectorState="Aguardando primeira pesquisa";
    private E5Engine embeddingEngine;
    private volatile boolean modelLoaded=false;
    private volatile boolean llmBusy=false;
    private volatile String modelPhase="none";
    private volatile String modelError="";
    private volatile long lastDurationMs=0;
    private volatile long generationStarted=0;
    private volatile String activeGenerationId="";
    private volatile int copyProgress=0;
    private static final boolean NATIVE_AVAILABLE;
    static {
        boolean available=false;
        if(BuildConfig.ENABLE_LOCAL_MODELS){
            try { System.loadLibrary("hinosllm"); available=true; }
            catch(Throwable error) { available=false; }
        }
        NATIVE_AVAILABLE=available;
    }
    private static native String nativeLoad(String path);
    private static native int nativeLoadProgress();
    private static native byte[] nativeGenerate(byte[] prompt,byte[] grammar,int maxTokens,int timeoutMs,long[] metrics);
    private static native int nativeGenerationStage();
    private static native void nativeResetCancellation();
    private static native void nativeCancel();
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
        if(BuildConfig.ENABLE_LOCAL_MODELS){
            web.addJavascriptInterface(new ModelBridge(), "NativeGGUF");
        }
        if(BuildConfig.ENABLE_LOCAL_EMBEDDINGS||BuildConfig.ENABLE_LOCAL_MODELS){
            web.addJavascriptInterface(new VectorBridge(), "NativeVector");
        }
        web.loadUrl(HOST + "/assets/index.html");
    }
    private final class VectorBridge {
        @JavascriptInterface public String status(){
            try{return new JSONObject().put("available",true).put("state",vectorState).toString();}
            catch(Exception e){return "{}";}
        }
        @JavascriptInterface public void embed(String requestId,String query){
            if(requestId==null||requestId.length()>64||query==null||query.length()>500)return;
            vectorExecutor.execute(()->{
                long start=System.currentTimeMillis();
                try{
                    if(embeddingEngine==null)embeddingEngine=new E5Engine(MainActivity.this);
                    float[] v=embeddingEngine.embed(query,progress->{vectorState=progress;sendProgress(requestId,progress);});
                    org.json.JSONArray arr=new org.json.JSONArray();
                    for(float value:v)arr.put(value);
                    vectorState="Modelo E5 pronto";
                    sendResult(new JSONObject().put("id",requestId).put("ok",true).put("vector",arr).put("ms",System.currentTimeMillis()-start));
                }catch(Throwable e){
                    vectorState="Falha: "+e.getClass().getSimpleName();
                    try{sendResult(new JSONObject().put("id",requestId).put("ok",false)
                        .put("error",e.getClass().getSimpleName()+": "+e.getMessage()));}catch(Exception ignored){}
                }
            });
        }
        private void sendProgress(String id,String message){
            try{JSONObject data=new JSONObject().put("id",id).put("message",message);
                runOnUiThread(()->web.evaluateJavascript("window.VectorNative&&window.VectorNative.progress("+data.toString()+")",null));
            }catch(Exception ignored){}
        }
        private void sendResult(JSONObject data){
            runOnUiThread(()->web.evaluateJavascript("window.VectorNative&&window.VectorNative.complete("+data.toString()+")",null));
        }
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
                getSharedPreferences(PREFS,MODE_PRIVATE).edit()
                    .putString(MODEL_URI_KEY,uri.toString())
                    .putString(MODEL_DISPLAY_NAME_KEY,name)
                    .putLong(MODEL_BYTES_KEY,modelSize(uri)).apply();
                modelError="";
                lastDurationMs=0;
                modelPhase="selected";
                if(modelLoaded){
                    llmBusy=true;
                    llmExecutor.execute(()->{
                        try{
                            if(NATIVE_AVAILABLE)nativeUnload();
                            modelLoaded=false;
                        }catch(Exception ignored){}
                        finally{llmBusy=false;ggufEvent("selection",true,name);}
                    });
                }else ggufEvent("selection",true,name);
            }catch(Exception ex){modelError=errorMessage(ex);ggufEvent("selection",false,modelError);}
        }
    }
    @Override public void onBackPressed(){
        web.evaluateJavascript("(function(){var layer=document.querySelector('.modal-layer:not(.hidden)');if(layer){var close=layer.querySelector('[data-close]');if(close)close.click();return true;}return false;})()", value -> {
            if (!"true".equals(value)) MainActivity.super.onBackPressed();
        });
    }
    @Override protected void onDestroy(){
        if(pendingFile!=null)pendingFile.onReceiveValue(null);
        if(NATIVE_AVAILABLE&&!activeGenerationId.isEmpty())nativeCancel();
        if(web!=null){web.removeJavascriptInterface("NativeHinos");web.removeJavascriptInterface("NativeGGUF");web.destroy();web=null;}
        llmExecutor.execute(()->{if(NATIVE_AVAILABLE)nativeUnload();});
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
    // ACTION_OPEN_DOCUMENT concede acesso ao URI, não um caminho de arquivo reabrível por llama.cpp.
    // O Android nega a reabertura de /proc/self/fd/N em vários provedores SAF.
    // Copiar por fluxo para o diretório privado do app permite mmap por caminho real, sem permissão global.
    private File modelCacheDir() throws IOException {
        File dir = new File(getFilesDir(), "gguf-cache");
        if (!dir.isDirectory() && !dir.mkdirs()) throw new IOException("Não foi possível criar a pasta privada do modelo.");
        return dir;
    }
    private long cachedModelBytes() {
        File dir = new File(getFilesDir(), "gguf-cache");
        long total=0;
        File[] files=dir.listFiles();
        if(files!=null)for(File item:files)if(item.isFile())total+=item.length();
        return total;
    }
    private static boolean validMagic(File path) {
        if (!path.isFile() || path.length()<32) return false;
        try(InputStream input = new FileInputStream(path)) {
            return input.read()=='G' && input.read()=='G' && input.read()=='U' && input.read()=='F';
        }catch(IOException ignored){return false;}
    }
    private static String cacheKey(Uri uri, long size) throws Exception {
        MessageDigest digest=MessageDigest.getInstance("SHA-256");
        byte[] value=digest.digest((uri.toString()+"|"+size).getBytes(StandardCharsets.UTF_8));
        StringBuilder hex=new StringBuilder();
        for(int i=0;i<12;i++)hex.append(String.format(Locale.ROOT,"%02x",value[i]&255));
        return hex.toString();
    }
    private File prepareModelFile(Uri uri,long expectedSize) throws Exception {
        File dir=modelCacheDir();
        File target=new File(dir,"gguf-"+cacheKey(uri,expectedSize)+".gguf");
        if(validMagic(target) && (expectedSize<0 || expectedSize==target.length())) {
            copyProgress=100;
            return target;
        }
        if(target.exists()&&!target.delete())throw new IOException("Não foi possível substituir a cópia anterior do modelo.");
        // Uma única cópia é mantida: modelos antigos são liberados antes de testar espaço.
        File[] stored=dir.listFiles();
        if(stored!=null)for(File file:stored)if(!file.equals(target)&&file.isFile())file.delete();
        long available=new StatFs(dir.getAbsolutePath()).getAvailableBytes();
        if(expectedSize>0 && available < expectedSize + 64L*1024*1024) {
            long requiredMB=(expectedSize+64L*1024*1024+1048575)/1048576;
            throw new IOException("Armazenamento insuficiente para copiar o GGUF: necessário aproximadamente " + requiredMB + " MB, livre " + (available/1048576) + " MB. Não é um erro de RAM.");
        }
        File partial=new File(dir,target.getName()+".partial");
        copyProgress=0;
        modelPhase="copying";
        ggufEvent("phase",true,"Copiando GGUF com autorização do Android…");
        long transferred=0;
        try {
            try(InputStream input=getContentResolver().openInputStream(uri);
                FileOutputStream output=new FileOutputStream(partial)) {
                if(input==null)throw new IOException("O Android não liberou a leitura do modelo. Selecione o arquivo novamente.");
                byte[] buffer=new byte[1024*1024];
                int n;
                while((n=input.read(buffer))!=-1) {
                    output.write(buffer,0,n);
                    transferred+=n;
                    if(expectedSize>0)copyProgress=(int)Math.min(99, transferred*100/expectedSize);
                }
                output.getFD().sync();
            }
            if(expectedSize>0 && transferred!=expectedSize)throw new IOException("Cópia incompleta: esperado "+expectedSize+" bytes, obtidos "+transferred+".");
            if(!validMagic(partial))throw new IOException("O arquivo copiado não contém um cabeçalho GGUF válido.");
            if(!partial.renameTo(target))throw new IOException("Não foi possível finalizar a cópia do GGUF.");
            copyProgress=100;
            return target;
        }catch(SecurityException ex){
            throw new IOException("A autorização de leitura do arquivo expirou. Selecione o GGUF novamente no Android.",ex);
        }finally{
            if(partial.exists())partial.delete();
        }
    }
    private static String errorMessage(Throwable ex){return ex.getMessage()==null?ex.getClass().getSimpleName():ex.getMessage();}
    private void ggufEvent(String event,boolean ok,String value){
        ggufEvent(event,ok,value,"",null);
    }
    private void ggufEvent(String event,boolean ok,String value,String requestId,JSONObject metrics){
        String js="window.__ggufNativeEvent && window.__ggufNativeEvent("+JSONObject.quote(event)+","+ok+","+
            JSONObject.quote(value)+","+JSONObject.quote(requestId)+","+metrics+");";
        runOnUiThread(()->{if(web!=null)web.evaluateJavascript(js,null);});
    }
    public class ModelBridge {
        @JavascriptInterface public String status(){
            try{
                android.content.SharedPreferences preferences=getSharedPreferences(PREFS,MODE_PRIVATE);
                String uriString=preferences.getString(MODEL_URI_KEY,null);
                boolean selected=uriString!=null;
                String phase=modelPhase;
                JSONObject result=new JSONObject();
                result.put("available",NATIVE_AVAILABLE);
                result.put("selected",selected);
                result.put("loaded",modelLoaded);
                result.put("busy",llmBusy);
                result.put("name",selected?preferences.getString(MODEL_DISPLAY_NAME_KEY,"GGUF selecionado"):"");
                if(selected&&"none".equals(phase))phase="selected";
                result.put("phase",NATIVE_AVAILABLE?phase:"unavailable");
                result.put("progress",llmBusy&&"loading".equals(phase)?nativeLoadProgress():("copying".equals(phase)?copyProgress:0));
                result.put("cachedMB", Math.round(cachedModelBytes()/1048576.0));
                result.put("storageMB", Math.round(new StatFs(getFilesDir().getAbsolutePath()).getAvailableBytes()/1048576.0));
                result.put("lastError",modelError);
                result.put("lastDurationMs",lastDurationMs);
                if(NATIVE_AVAILABLE&&"generating".equals(phase)){
                    result.put("generationStage",nativeGenerationStage());
                    result.put("elapsedMs",android.os.SystemClock.elapsedRealtime()-generationStarted);
                }
                long fileSize=preferences.getLong(MODEL_BYTES_KEY,-1);
                if(selected&&fileSize>0)result.put("modelMB",Math.round(fileSize/1048576.0));
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
        @JavascriptInterface public synchronized void loadModel(){
            if(!NATIVE_AVAILABLE){modelPhase="unavailable";ggufEvent("load",false,"Motor nativo indisponível neste dispositivo ARM64.");return;}
            if(llmBusy){ggufEvent("load",false,"A IA já está ocupada.");return;}
            llmBusy=true;modelPhase="copying";copyProgress=0;modelError="";lastDurationMs=0;
            final long start=android.os.SystemClock.elapsedRealtime();
            ggufEvent("phase",true,"Preparando acesso ao GGUF…");
            llmExecutor.execute(()->{
                boolean ok=false;
                String message;
                try{
                    android.content.SharedPreferences preferences=getSharedPreferences(PREFS,MODE_PRIVATE);
                    String uriString=preferences.getString(MODEL_URI_KEY,null);
                    if(uriString==null)throw new IOException("Selecione um GGUF primeiro.");
                    Uri uri=Uri.parse(uriString);
                    long size=modelSize(uri);
                    if(size<0)size=preferences.getLong(MODEL_BYTES_KEY,-1);
                    android.app.ActivityManager.MemoryInfo memory=new android.app.ActivityManager.MemoryInfo();
                    ((android.app.ActivityManager)getSystemService(ACTIVITY_SERVICE)).getMemoryInfo(memory);
                    // A RAM livre não é toda utilizável pelo processo Android, mesmo que pareça suficiente.
                    // Não rejeitar modelos com base apenas no tamanho do GGUF: mmap é paginado pelo sistema.
                    if(size>0&&size>memory.totalMem*1.2)
                        throw new IOException("Arquivo muito maior que a RAM física. Tente uma quantização menor.");
                    if(modelLoaded){nativeUnload();modelLoaded=false;}
                    File modelFile=prepareModelFile(uri,size);
                    modelPhase="loading";
                    ggufEvent("phase",true,"Modelo copiado. Carregando pesos…");
                    message=nativeLoad(modelFile.getAbsolutePath());
                    android.content.SharedPreferences.Editor metadata=preferences.edit().putLong(MODEL_BYTES_KEY,size);
                    if(!preferences.contains(MODEL_DISPLAY_NAME_KEY))metadata.putString(MODEL_DISPLAY_NAME_KEY,modelName(uri));
                    metadata.apply();
                    modelLoaded=true;modelPhase="ready";modelError="";
                    lastDurationMs=android.os.SystemClock.elapsedRealtime()-start;
                    ok=true;
                }catch(Throwable ex){
                    modelLoaded=false;modelPhase="error";modelError=errorMessage(ex);
                    message=modelError;
                }finally{llmBusy=false;}
                ggufEvent("load",ok,message);
            });
        }
        @JavascriptInterface public synchronized void cancel(String requestId){
            if(NATIVE_AVAILABLE && requestId!=null && !requestId.isEmpty() && requestId.equals(activeGenerationId)){
                nativeCancel();
            }
        }
        @JavascriptInterface public synchronized void generate(String prompt,String requestId,String grammar,int maxTokens,int timeoutMs){
            if(requestId==null||!requestId.matches("[0-9]{1,12}"))return;
            if(llmBusy){ggufEvent("generate",false,"O modelo já está em uso.",requestId,null);return;}
            if(!NATIVE_AVAILABLE||!modelLoaded){ggufEvent("generate",false,"Carregue um GGUF primeiro.",requestId,null);return;}
            if(prompt==null||prompt.trim().isEmpty()||prompt.length()>2400||grammar==null||grammar.length()>2400
                    ||maxTokens<1||maxTokens>120||timeoutMs<1000||timeoutMs>60000){
                ggufEvent("generate",false,"Parâmetros de geração inválidos.",requestId,null);
                return;
            }
            nativeResetCancellation();
            generationStarted=android.os.SystemClock.elapsedRealtime();
            llmBusy=true;
            activeGenerationId=requestId;
            modelPhase="generating";
            modelError="";
            ggufEvent("phase",true,"Preparando a geração…");
            llmExecutor.execute(()->{
                String value;
                JSONObject metrics=null;
                boolean ok=false;
                try{
                    long[] timing=new long[4];
                    byte[] output=nativeGenerate(prompt.getBytes(StandardCharsets.UTF_8),grammar.getBytes(StandardCharsets.UTF_8),maxTokens,timeoutMs,timing);
                    value=new String(output,StandardCharsets.UTF_8);
                    metrics=new JSONObject().put("setupMs",timing[0]).put("prefillMs",timing[1])
                        .put("firstTokenMs",timing[2]).put("tokens",timing[3]);
                    ok=true;
                }catch(Throwable ex){
                    value=errorMessage(ex);
                    modelError=value.equals("Geração cancelada.")?"":value;
                }
                lastDurationMs=android.os.SystemClock.elapsedRealtime()-generationStarted;
                activeGenerationId="";
                modelPhase="ready";
                llmBusy=false;
                ggufEvent("generate",ok,value,requestId,metrics);
            });
        }
    }

    public class ImportBridge {
        /** Metadados da própria instalação, sem depender de serviços ou do catálogo. */
        @JavascriptInterface public String buildInfo(){
            try{
                return new JSONObject()
                    .put("appName", "Buscador de Hinos")
                    .put("developer", "Pablo Erlis")
                    .put("versionName", BuildConfig.VERSION_NAME)
                    .put("versionCode", BuildConfig.VERSION_CODE)
                    .put("buildType", BuildConfig.BUILD_TYPE)
                    .put("sourceRevision", BuildConfig.SOURCE_REVISION)
                    .put("buildDateUtc", BuildConfig.BUILD_DATE_UTC)
                    .toString();
            }catch(Exception error){return "{}";}
        }
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
