package br.com.buscadordehinos.app;

import android.webkit.WebView;
import android.view.ViewGroup;
import androidx.test.core.app.ActivityScenario;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import org.junit.Test;
import org.junit.runner.RunWith;
import java.security.MessageDigest;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;
import static org.junit.Assert.*;

/**
 * Teste real no emulador: WebView -> JavaScript -> NativeVector ->
 * E5Engine -> ONNX Runtime -> callback JavaScript, sem serviço externo.
 */
@RunWith(AndroidJUnit4.class)
public class E5DeviceSmokeTest {
    private static String evaluate(WebView view, String script) throws Exception {
        CountDownLatch complete=new CountDownLatch(1);
        AtomicReference<String> result=new AtomicReference<>("");
        InstrumentationRegistry.getInstrumentation().runOnMainSync(
            ()->view.evaluateJavascript(script,value->{
                result.set(value);
                complete.countDown();
            }));
        assertTrue("WebView JS callback timed out",complete.await(25,TimeUnit.SECONDS));
        return result.get();
    }

    @Test public void webViewLoadsAndNativeEmbeddingsWork() throws Exception {
        try(ActivityScenario<MainActivity> screen=ActivityScenario.launch(MainActivity.class)) {
            AtomicReference<WebView> browser=new AtomicReference<>();
            screen.onActivity(activity->{
                ViewGroup root=activity.findViewById(android.R.id.content);
                assertNotNull("Activity content missing",root);
                assertTrue("WebView must be root child",root.getChildCount()>0);
                assertTrue(root.getChildAt(0) instanceof WebView);
                browser.set((WebView)root.getChildAt(0));
            });
            WebView web=browser.get();
            assertNotNull(web);
            boolean ready=false;
            long limit=System.currentTimeMillis()+45_000;
            while(System.currentTimeMillis()<limit) {
                String v=evaluate(web,
                    "Boolean(typeof OfflineAPI!=='undefined' && window.NativeVector && " +
                    "window.VectorNative && document.getElementById('search-input') && " +
                    "document.getElementById('about-app'))");
                if("true".equals(v)){ready=true;break;}
                Thread.sleep(1000);
            }
            assertTrue("Interface or E5 native bridge did not load",ready);
            assertEquals("Settings navigation or collection synchronization failed","true",
                evaluate(web,
                    "(()=>{" +
                    "const el=id=>document.getElementById(id);" +
                    "const open=el('open-settings'); open.focus(); open.click();" +
                    "const library=el('settings-panel-library');" +
                    "const main=el('collection-principal');" +
                    "const quick=document.querySelector('[data-collection=principal]');" +
                    "const previous=main.checked; main.click();" +
                    "const synced=quick.checked===main.checked&&main.checked!==previous;" +
                    "main.click();" +
                    "const search=el('settings-tab-search'); search.click();" +
                    "const preferences=library.hidden&&!el('settings-panel-search').hidden;" +
                    "el('settings-tab-about').click();" +
                    "const about=!el('settings-panel-about').hidden&&el('about-app').open;" +
                    "document.querySelector('#settings-layer .icon-button[data-close]').click();" +
                    "const restored=document.activeElement===open;" +
                    "el('ai-indicator').click();" +
                    "const ai=!el('settings-panel-ai').hidden;" +
                    "document.querySelector('#settings-layer .icon-button[data-close]').click();" +
                    "return synced&&preferences&&about&&restored&&ai;})()"));
            String metadata=evaluate(web,
                "(()=>{try{const a=JSON.parse(window.NativeHinos.buildInfo());" +
                "return a.versionName==='" + BuildConfig.VERSION_NAME +
                "' && a.developer==='Pablo Erlis' && " +
                "a.versionCode===" + BuildConfig.VERSION_CODE +
                ";}catch(e){return false}})()");
            assertEquals("Installed app metadata does not match About view","true",metadata);
            assertEquals("RRF default or controls were not loaded in WebView","true",
                evaluate(web,"Boolean(typeof FusionRRF!=='undefined' && " +
                    "OfflineAPI.searchOptions().fusionMode==='rrf' && " +
                    "document.getElementById('fusion-mode'))"));
            assertEquals("Event engine or its configuration did not load","true",
                evaluate(web,"Boolean(typeof EventFrameEngine!=='undefined' && " +
                    "OfflineAPI.searchOptions().eventEvidence===true && " +
                    "document.getElementById('event-toggle'))"));
            assertEquals("Android narrative actor/action engine not functional","true",
                evaluate(web,
                    "(()=>{try{" +
                    "const verses=['O viajante partiu e deixou a casa do pai.'," +
                    "'O filho voltou e foi recebido pelo pai que o perdoou.'];" +
                    "const db={narratives:[{id:'qa',label:'Uma viagem',reference:'QA'," +
                    "aliases:['Filho voltou ao pai']}]};" +
                    "const bible={lookup:()=>({verses:verses.map(text=>({text}))})};" +
                    "const engine=EventFrameEngine.create(db,bible);" +
                    "const hymn={id:1,title:'Relato',lyrics:" +
                    "'Deixei minha casa.\\nVoltei ao pai e fui recebido e perdoado.'};" +
                    "engine.setCorpus([hymn]);" +
                    "return engine.evaluate(hymn,{narrative:'Uma viagem'}).score>=8;" +
                    "}catch(e){return false}})()"));
            // Esta é a variante completa: ONNX e llama.cpp devem estar
            // disponíveis simultaneamente no Android, sem carregar pesos GGUF.
            assertEquals("Native GGUF bridge/library missing from full-feature APK","true",
                evaluate(web,"(()=>{try{const m=window.NativeGGUF;" +
                    "return Boolean(m && typeof m.status==='function' && " +
                    "JSON.parse(m.status()).available===true);}catch(e){return false}})()"));
            assertEquals("Native embedding request was not dispatched","true",
                evaluate(web,
                    "window.__e5QaReply=null;" +
                    "window.__e5QaOriginalComplete=window.VectorNative.complete;" +
                    "window.VectorNative.complete=function(answer){" +
                    "window.__e5QaReply=answer;window.__e5QaOriginalComplete(answer);};" +
                    "window.NativeVector.embed('e5-qa','Uma mulher enferma tocou nas vestes de Jesus e foi curada');true;"));
            boolean completed=false;
            limit=System.currentTimeMillis()+180_000;
            while(System.currentTimeMillis()<limit){
                if("true".equals(evaluate(web,
                    "Boolean(window.__e5QaReply && typeof window.__e5QaReply.ok==='boolean')"))){
                    completed=true;
                    break;
                }
                Thread.sleep(1200);
            }
            assertTrue("Android native ONNX inference never returned",completed);
            String error=evaluate(web,
                "window.__e5QaReply && window.__e5QaReply.error || ''");
            assertEquals("Android E5 ONNX inference failed: "+error,"true",
                evaluate(web,
                    "(()=>{const e=window.__e5QaReply;" +
                    "if(!e.ok||!Array.isArray(e.vector)||e.vector.length!==384)return false;" +
                    "if(!e.vector.every(Number.isFinite))return false;" +
                    "const n=e.vector.reduce((s,x)=>s+x*x,0);" +
                    "return n>.97&&n<1.03;})()"));
            // Canonical UINT8 semantic query (not a hymn lyric).
            // The check compares 384 real Android ONNX dimensions to CPU-probed
            // ONNX outputs from AMD EPYC 7763/9V45 and Intel Xeon 6975P-C.
            String arrayJSON=evaluate(web,"JSON.stringify(window.__e5QaReply.vector)");
            String decoded=(String)new org.json.JSONTokener(arrayJSON).nextValue();
            org.json.JSONArray values=new org.json.JSONArray(decoded);
            assertEquals("Android native E5 vector dimension changed",384,values.length());
            byte[] q8=new byte[384];
            for(int i=0;i<384;i++){
                double value=values.getDouble(i);
                assertTrue("Nonfinite Android E5 dimension",Double.isFinite(value));
                q8[i]=(byte)Math.max(-127,Math.min(127,(int)Math.rint(value*127)));
            }
            // The reference is generated from the same actual ONNX vectors as
            // Agent 9 and is included ONLY in the instrumentation APK.
            // Architecture-dependent quantized kernels need numeric, not binary,
            // parity. The measured x86 emulator difference had cosine 0.9958
            // and max q8 component delta 2; tests fail for material divergence.
            java.io.ByteArrayOutputStream buffer=new java.io.ByteArrayOutputStream();
            try(java.io.InputStream input=InstrumentationRegistry.getInstrumentation()
                    .getContext().getAssets().open("e5-query-canary.json")){
                byte[] tmp=new byte[4096];int n;
                while((n=input.read(tmp))!=-1)buffer.write(tmp,0,n);
            }
            org.json.JSONObject golden=new org.json.JSONObject(
                new String(buffer.toByteArray(),java.nio.charset.StandardCharsets.UTF_8));
            assertEquals(1,golden.getInt("schema_version"));
            assertEquals("actual_pinned_e5_onnx_inference",golden.getString("source"));
            assertEquals("ee13574a23e4384619a172d4c0c8c6b825528fde30258c56130d5e3efcc9c8f1",
                golden.getString("model_sha256"));
            assertEquals("Uma mulher enferma tocou nas vestes de Jesus e foi curada",
                golden.getString("query"));
            org.json.JSONArray reference=golden.getJSONArray("vector");
            assertEquals("Android reference dimension mismatch",384,reference.length());
            byte[] expectedQ8=new byte[384];
            int altered=0,maxDelta=0;
            double dot=0,normActual=0,normExpected=0;
            for(int i=0;i<384;i++){
                double v=reference.getDouble(i);
                assertTrue("Invalid pinned E5 QA vector",Double.isFinite(v));
                expectedQ8[i]=(byte)Math.max(-127,Math.min(127,(int)Math.rint(v*127)));
                int a=q8[i],b=expectedQ8[i],delta=Math.abs(a-b);
                if(delta>0)altered++;
                maxDelta=Math.max(maxDelta,delta);
                dot+=(double)a*b;normActual+=(double)a*a;normExpected+=(double)b*b;
            }
            byte[] expectedDigest=MessageDigest.getInstance("SHA-256").digest(expectedQ8);
            StringBuilder canonicalSha=new StringBuilder();
            for(byte x:expectedDigest)canonicalSha.append(
                String.format(java.util.Locale.US,"%02x",x&255));
            assertEquals("Golden vector was not generated from approved ONNX source",
                golden.getString("expected_q8_sha256"),canonicalSha.toString());
            assertEquals("Golden vector SHA does not match the approved E5 canary",
                "555bda01cdc0f22dcc4864d75303562e5f7cbb539530aeabc476218b5f0eb26d",
                canonicalSha.toString());
            double cosine=dot/Math.sqrt(normActual*normExpected);
            String metrics="cosine="+cosine+", max_q8_delta="+maxDelta+
                ", changed_components="+altered+"/384";
            android.util.Log.i("E5_CANARY_QA",metrics);
            assertTrue("Android E5 vector differs materially from pinned ONNX: "+metrics,
                Double.isFinite(cosine) && cosine>=0.992 && maxDelta<=3 &&
                altered<=154);

        }
    }
}
