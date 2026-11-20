package br.com.buscadordehinos.app;

import android.app.Activity;
import android.app.Instrumentation;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.os.SystemClock;
import android.util.Log;
import android.view.ViewGroup;
import android.webkit.WebView;
import java.io.File;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.Locale;
import java.util.concurrent.ArrayBlockingQueue;
import java.util.concurrent.TimeUnit;
import org.json.JSONArray;
import org.json.JSONObject;
import org.json.JSONTokener;

public final class GgufSmokeRunner extends Instrumentation {
    private Bundle arguments;
    private WebView web;

    @Override public void onCreate(Bundle arguments) {
        super.onCreate(arguments);
        this.arguments = arguments;
        start();
    }

    @Override public void onStart() {
        Bundle result = new Bundle();
        try {
            exercise(result);
            result.putString("result", "PASS");
            finish(Activity.RESULT_OK, result);
        } catch (Throwable failure) {
            Log.e("HinoGgufSmoke", "Smoke test failed", failure);
            result.putString("result", "FAIL");
            result.putString("failure", failure.toString());
            finish(Activity.RESULT_CANCELED, result);
        }
    }

    private void exercise(Bundle result) throws Exception {
        Context target = getTargetContext();
        File source = new File(target.getFilesDir(), "smoke.gguf");
        long size = source.length();
        if (size < 1024) throw new IllegalStateException("Model file missing from target app");
        String uri = Uri.fromFile(source).toString();
        byte[] digest = MessageDigest.getInstance("SHA-256")
            .digest((uri + "|" + size).getBytes(StandardCharsets.UTF_8));
        StringBuilder key = new StringBuilder();
        for (int i = 0; i < 12; i++) key.append(String.format(Locale.ROOT, "%02x", digest[i] & 255));
        File cache = new File(target.getFilesDir(), "gguf-cache");
        if (!cache.isDirectory() && !cache.mkdirs()) throw new IllegalStateException("Cannot prepare model cache");
        if (!source.renameTo(new File(cache, "gguf-" + key + ".gguf"))) throw new IllegalStateException("Cannot stage model cache");
        boolean saved = target.getSharedPreferences("hinos_local_llm", Context.MODE_PRIVATE).edit()
            .putString("model_uri", uri).putString("model_display_name", arguments.getString("model"))
            .putLong("model_bytes", size).commit();
        if (!saved) throw new IllegalStateException("Cannot save model selection");

        Intent intent = new Intent(target, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        Activity activity = startActivitySync(intent);
        runOnMainSync(() -> {
            ViewGroup container = activity.findViewById(android.R.id.content);
            web = (WebView) container.getChildAt(0);
        });
        waitFor("typeof window.__ggufNativeEvent === 'function'", 20000);
        evaluate("window.smokeEvents=[]; const originalSmokeHandler=window.__ggufNativeEvent;"
            + "window.__ggufNativeEvent=(...args)=>{window.smokeEvents.push(args);originalSmokeHandler(...args);};"
            + "window.NativeGGUF.loadModel(); true");
        long loadStart = SystemClock.elapsedRealtime();
        JSONArray load = event("load", 0, 100000);
        result.putLong("load_ms", SystemClock.elapsedRealtime() - loadStart);
        result.putString("load_message", load.getString(2));
        if ("unsupported".equals(arguments.getString("expect"))) {
            if (load.getBoolean(1) || !load.getString(2).toLowerCase(Locale.ROOT).contains("gemma4")) {
                throw new IllegalStateException("Expected a gemma4 architecture rejection: " + load);
            }
            return;
        }
        requireSuccess("load", load);

        evaluate("document.getElementById('gguf-test').click(); true");
        JSONArray diagnostic = event("generate", 0, 55000);
        result.putString("diagnostic", diagnostic.toString());
        requireSuccess("diagnostic", diagnostic);
        if (!"OK".equals(diagnostic.getString(2).trim())) throw new IllegalStateException("Unexpected diagnostic " + diagnostic);

        evaluate("window.smokeSearch='pending'; (async()=>{"
            + "await OfflineAPI.request('/api/import',{data:[{name:'Coletânea 2018',songs:["
            + "{title:'001 - Voltar para Deus',content:'Eu volto para Deus. O Pai me acolhe com perdão e graça.'},"
            + "{title:'002 - Perdão do Pai',content:'Deus me recebe quando volto arrependido. Seu amor me dá perdão.'},"
            + "{title:'003 - Caminho da graça',content:'Em arrependimento eu volto para Deus. Ele renova minha esperança.'}]}]});"
            + "await refreshStatus(); await performSearch('voltar para Deus e receber perdão',{autoAI:false});"
            + "if(state.lastResults.length<2)throw Error('fixture sem candidatos');GGUF.info();"
            + "window.smokeSearch='ready';})().catch(e=>{window.smokeSearch=e.message;}); true");
        waitFor("window.smokeSearch !== 'pending'", 15000);
        if (!"ready".equals(evaluate("window.smokeSearch"))) {
            throw new IllegalStateException("Search fixture failed: " + evaluate("window.smokeSearch"));
        }

        long compareStart = SystemClock.elapsedRealtime();
        evaluate("document.getElementById('gguf-compare-model').click(); true");
        JSONArray comparison = event("generate", 1, 70000);
        result.putString("comparison_first", comparison.toString());
        requireSuccess("comparison", comparison);
        if (comparison.getString(2).trim().startsWith("{")) {
            JSONArray continued = event("generate", 2, 65000);
            result.putString("comparison_second", continued.toString());
            requireSuccess("comparison after tool lookup", continued);
        }
        waitFor("!document.getElementById('gguf-comparison').classList.contains('hidden')", 4000);
        result.putLong("comparison_ms", SystemClock.elapsedRealtime() - compareStart);
        result.putString("comparison_ui", String.valueOf(evaluate("document.getElementById('gguf-comparison-text').textContent")));
    }

    private void requireSuccess(String stage, JSONArray event) throws Exception {
        if (!event.getBoolean(1)) throw new IllegalStateException(stage + " failure: " + event.getString(2));
    }

    private Object evaluate(String js) throws Exception {
        ArrayBlockingQueue<String> result = new ArrayBlockingQueue<>(1);
        runOnMainSync(() -> web.evaluateJavascript(js, value -> result.offer(value == null ? "null" : value)));
        String raw = result.poll(8, TimeUnit.SECONDS);
        if (raw == null) throw new IllegalStateException("WebView did not answer");
        return new JSONTokener(raw).nextValue();
    }

    private JSONArray event(String name, int index, long timeoutMs) throws Exception {
        long deadline = SystemClock.elapsedRealtime() + timeoutMs;
        String expression = "window.smokeEvents.filter(e=>e[0]===" + JSONObject.quote(name) + ")[" + index + "] || null";
        while (SystemClock.elapsedRealtime() < deadline) {
            Object value = evaluate(expression);
            if (value instanceof JSONArray) return (JSONArray) value;
            SystemClock.sleep(250);
        }
        throw new IllegalStateException("No " + name + " event " + index + "; state: " + evaluate("window.NativeGGUF.status()"));
    }

    private void waitFor(String expression, long timeoutMs) throws Exception {
        long deadline = SystemClock.elapsedRealtime() + timeoutMs;
        while (SystemClock.elapsedRealtime() < deadline) {
            if (Boolean.TRUE.equals(evaluate(expression))) return;
            SystemClock.sleep(200);
        }
        throw new IllegalStateException("WebView condition timed out: " + expression);
    }
}
