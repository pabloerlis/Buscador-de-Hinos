package br.com.buscadordehinos.app;

import android.app.Activity;
import android.content.Intent;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
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
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import org.json.JSONObject;

public final class MainActivity extends Activity {
    private static final String HOST = "https://appassets.androidplatform.net";
    private static final String DATA_URL = "https://raw.githubusercontent.com/italozaina/projection-html5-icm/master/data/data.json";
    private static final int MAX_JSON_BYTES = 12_000_000;
    private static final int PICK_FILE = 1205;
    private static final int CREATE_DICTIONARY_BACKUP = 1207;
    private static final int MAX_DICTIONARY_BACKUP_BYTES = 256_000;
    private final ExecutorService harrierExecutor=Executors.newSingleThreadExecutor();
    private HarrierEngine harrierEngine;
    private volatile boolean harrierReady=false,harrierRemoving=false,closing=false;
    private final java.util.concurrent.atomic.AtomicBoolean inferenceBusy=new java.util.concurrent.atomic.AtomicBoolean(false);
    private void closeHarrier(){
        harrierReady=false;
        if(harrierEngine!=null){try{harrierEngine.close();}catch(Exception ignored){}harrierEngine=null;}
    }
    private WebView web;
    private ValueCallback<Uri[]> pendingFile;
    private byte[] pendingDictionaryBackup;

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
                if ("/harrier/tokenizer.json".equals(path)||"/harrier/tokenizer_config.json".equals(path)||"/harrier/index.json".equals(path)||"/harrier/manifest.json".equals(path)){
                    File file=HarrierPackage.get(getFilesDir()).localFile(path.substring("/harrier/".length()));
                    if(file==null)return forbidden();
                    try{return new WebResourceResponse("application/json","UTF-8",new FileInputStream(file));}
                    catch(IOException e){return forbidden();}
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
        web.addJavascriptInterface(new HarrierPackageBridge(), "NativeHarrierPackage");
        web.loadUrl(HOST + "/assets/index.html");
    }
    private final class HarrierPackageBridge {
        private final HarrierPackage pack=HarrierPackage.get(getFilesDir());
        @JavascriptInterface public String status(){
            try{return new JSONObject().put("phase",pack.phase()).put("message",pack.message()).put("downloaded",pack.downloaded()).put("total",HarrierPackage.TOTAL_BYTES).put("ready",harrierReady&&!harrierRemoving&&!closing).put("removing",harrierRemoving).toString();}
            catch(Exception e){return "{}";}
        }
        @JavascriptInterface public void install(){pack.start();}
        @JavascriptInterface public void cancel(){pack.cancel();}
        @JavascriptInterface public void remove(){
            if("testing".equals(pack.phase())||"downloading".equals(pack.phase())||harrierRemoving||closing)return;
            harrierRemoving=true;harrierReady=false;
            try{harrierExecutor.execute(()->{try{closeHarrier();pack.remove();}finally{harrierRemoving=false;}});}
            catch(RuntimeException e){harrierRemoving=false;}
        }
        @JavascriptInterface public void embed(String requestId,String encodedIds){
            if(requestId==null||!requestId.matches("[0-9]{1,16}"))return;
            if(encodedIds==null||encodedIds.length()>2000||!harrierReady||harrierRemoving||closing){
                publishVector(requestId,null,0,"Harrier não está pronto.");return;
            }
            if(!inferenceBusy.compareAndSet(false,true)){publishVector(requestId,null,0,"Outra inferência está em andamento.");return;}
            try{harrierExecutor.execute(()->{
                long start=System.nanoTime();
                try{
                    if(!harrierReady||harrierEngine==null||harrierRemoving||closing||!"installed".equals(pack.phase()))throw new IOException("Harrier indisponível");
                    org.json.JSONArray tokens=new org.json.JSONArray(encodedIds);
                    if(tokens.length()<1||tokens.length()>192)throw new IOException("Limite de tokens");
                    long[] ids=new long[tokens.length()];
                    for(int i=0;i<ids.length;i++){
                        Object item=tokens.get(i);
                        if(!(item instanceof Number))throw new IOException("Token inválido");
                        double d=((Number)item).doubleValue();
                        if(!Double.isFinite(d)||d!=Math.rint(d)||d<0||d>200000)throw new IOException("Token inválido");
                        ids[i]=(long)d;
                    }
                    float[] vector=harrierEngine.embed(ids);
                    if(!harrierReady||closing||harrierRemoving)throw new IOException("Harrier desativado");
                    publishVector(requestId,vector,(System.nanoTime()-start)/1000000,"");
                }catch(Throwable error){
                    publishVector(requestId,null,0,error.getClass().getSimpleName()+": "+String.valueOf(error.getMessage()));
                }finally{inferenceBusy.set(false);}
            });}catch(RuntimeException e){inferenceBusy.set(false);publishVector(requestId,null,0,"Executor indisponível.");}
        }
        private void publishVector(String id,float[] vector,long ms,String error){
            try{
                JSONObject event=new JSONObject().put("id",id).put("ok",vector!=null).put("model","harrier-600m-q4f16").put("ms",ms).put("error",error);
                if(vector!=null){org.json.JSONArray arr=new org.json.JSONArray();for(float value:vector)arr.put(value);event.put("vector",arr);}
                runOnUiThread(()->{if(web!=null&&!closing)web.evaluateJavascript("window.HarrierRuntime&&window.HarrierRuntime.complete("+event.toString()+")",null);});
            }catch(Exception ignored){}
        }
        @JavascriptInterface public void diagnose(String encodedIds){
            if(encodedIds==null||encodedIds.length()>12000||harrierRemoving||closing){publishDiagnostic(false,null,"Diagnóstico indisponível");return;}
            final File directory;
            try{directory=pack.beginDiagnostic();harrierReady=false;}
            catch(Exception e){publishDiagnostic(false,null,e.getMessage());return;}
            try{harrierExecutor.execute(()->{
                try{
                    closeHarrier();
                    pack.verifyInstalled(directory);
                    java.io.ByteArrayOutputStream content=new java.io.ByteArrayOutputStream();
                    try(InputStream in=getAssets().open("harrier-conformance.json")){
                        byte[] buf=new byte[8192];int n;
                        while((n=in.read(buf))!=-1){if(content.size()+n>200000)throw new IOException("Referência muito grande");content.write(buf,0,n);}
                    }
                    JSONObject reference=new JSONObject(new String(content.toByteArray(),StandardCharsets.UTF_8));
                    long start=System.nanoTime();
                    harrierEngine=new HarrierEngine(directory);
                    JSONObject result=harrierEngine.verify(reference,new org.json.JSONArray(encodedIds),(System.nanoTime()-start)/1000000);
                    if(closing)throw new IOException("Atividade encerrada");
                    harrierReady=true;
                    pack.finishDiagnostic("Harrier validado e carregado.");
                    publishDiagnostic(true,result,"");
                }catch(Throwable error){
                    closeHarrier();
                    String message=error.getClass().getSimpleName()+": "+String.valueOf(error.getMessage());
                    pack.finishDiagnostic("Diagnóstico falhou: "+message);
                    publishDiagnostic(false,null,message);
                }
            });}catch(RuntimeException error){pack.finishDiagnostic("Diagnóstico indisponível.");publishDiagnostic(false,null,error.getMessage());}
        }
        private void publishDiagnostic(boolean ok,JSONObject result,String error){
            try{
                JSONObject event=new JSONObject().put("ok",ok).put("result",result==null?JSONObject.NULL:result).put("error",error==null?"":error);
                runOnUiThread(()->{if(web!=null)web.evaluateJavascript("window.HarrierDiagnostic&&window.HarrierDiagnostic.complete("+event.toString()+")",null);});
            }catch(Exception ignored){}
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
        if(requestCode==CREATE_DICTIONARY_BACKUP){
            byte[] bytes=pendingDictionaryBackup;
            pendingDictionaryBackup=null;
            Uri uri=resultCode==RESULT_OK&&data!=null?data.getData():null;
            if(uri==null){
                dictionaryBackupEvent("Exportação cancelada.");
            }else if(bytes==null){
                dictionaryBackupEvent("Abra o dicionário e tente exportar novamente.");
            }else{
                new Thread(()->{
                    try(OutputStream output=getContentResolver().openOutputStream(uri,"wt")){
                        if(output==null)throw new IOException("Arquivo indisponível.");
                        output.write(bytes);
                    }catch(Exception error){
                        dictionaryBackupEvent("Não foi possível gravar o backup.");
                        return;
                    }
                    dictionaryBackupEvent("Backup salvo.");
                },"hinos-dictionary-export").start();
            }
            return;
        }
        if(requestCode==PICK_FILE && pendingFile!=null){
            pendingFile.onReceiveValue(WebChromeClient.FileChooserParams.parseResult(resultCode,data));
            pendingFile=null;
        }
    }
    @Override public void onBackPressed(){
        web.evaluateJavascript("(function(){var layer=document.querySelector('.modal-layer:not(.hidden)');if(layer){var close=layer.querySelector('[data-close]');if(close)close.click();return true;}return false;})()", value -> {
            if (!"true".equals(value)) MainActivity.super.onBackPressed();
        });
    }
    @Override protected void onDestroy(){
        if(pendingFile!=null)pendingFile.onReceiveValue(null);
        if(web!=null){web.removeJavascriptInterface("NativeHinos");web.removeJavascriptInterface("NativeVector");web.removeJavascriptInterface("NativeHarrierPackage");web.destroy();web=null;}
        closing=true;harrierReady=false;
        try{harrierExecutor.execute(this::closeHarrier);}catch(RuntimeException ignored){}
        harrierExecutor.shutdown();
        super.onDestroy();
    }

    private void dictionaryBackupEvent(String message){
        runOnUiThread(()->{
            if(!isDestroyed())web.evaluateJavascript(
                "window.DictionaryBackup?.complete("+JSONObject.quote(message)+")",null);
        });
    }

    public class ImportBridge {
        @JavascriptInterface public void appearanceBars(String status,String navigation,boolean dark){
            if(status==null||navigation==null||!status.matches("#[0-9a-fA-F]{6}")||!navigation.matches("#[0-9a-fA-F]{6}"))return;
            runOnUiThread(()->{
                getWindow().setStatusBarColor(Color.parseColor(status));
                getWindow().setNavigationBarColor(Color.parseColor(navigation));
                int flags=getWindow().getDecorView().getSystemUiVisibility();
                flags &= ~android.view.View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR;
                if(Build.VERSION.SDK_INT>=26){if(dark)flags &= ~android.view.View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR;else flags |= android.view.View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR;}
                getWindow().getDecorView().setSystemUiVisibility(flags);
            });
        }
        @JavascriptInterface public void saveDictionaryBackup(String json){
            if(json==null||json.length()>MAX_DICTIONARY_BACKUP_BYTES){
                dictionaryBackupEvent("Backup acima de 256 KB.");
                return;
            }
            byte[] bytes=json.getBytes(StandardCharsets.UTF_8);
            if(bytes.length>MAX_DICTIONARY_BACKUP_BYTES){
                dictionaryBackupEvent("Backup acima de 256 KB.");
                return;
            }
            runOnUiThread(()->{
                if(pendingDictionaryBackup!=null)return;
                Intent intent=new Intent(Intent.ACTION_CREATE_DOCUMENT)
                    .addCategory(Intent.CATEGORY_OPENABLE)
                    .setType("application/json")
                    .putExtra(Intent.EXTRA_TITLE,"Buscador-de-Hinos-Dicionario.json");
                pendingDictionaryBackup=bytes;
                try{startActivityForResult(intent,CREATE_DICTIONARY_BACKUP);}
                catch(Exception error){
                    pendingDictionaryBackup=null;
                    dictionaryBackupEvent("O seletor de arquivos do Android está indisponível.");
                }
            });
        }
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
