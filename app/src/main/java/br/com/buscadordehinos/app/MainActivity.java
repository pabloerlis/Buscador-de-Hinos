package br.com.buscadordehinos.app;

import android.app.Activity;
import android.content.Intent;
import android.content.res.Configuration;
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
    }
    @Override public void onBackPressed(){
        web.evaluateJavascript("(function(){var layer=document.querySelector('.modal-layer:not(.hidden)');if(layer){var close=layer.querySelector('[data-close]');if(close)close.click();return true;}return false;})()", value -> {
            if (!"true".equals(value)) MainActivity.super.onBackPressed();
        });
    }
    @Override protected void onDestroy(){
        if(pendingFile!=null)pendingFile.onReceiveValue(null);
        if(web!=null){web.removeJavascriptInterface("NativeHinos");web.destroy();web=null;}
        super.onDestroy();
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
