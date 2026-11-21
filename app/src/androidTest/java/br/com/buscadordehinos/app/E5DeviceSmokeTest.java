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
            String metadata=evaluate(web,
                "(()=>{try{const a=JSON.parse(window.NativeHinos.buildInfo());" +
                "return a.versionName==='2.6.9' && a.developer==='Pablo Erlis' && " +
                "a.versionCode===28;}catch(e){return false}})()");
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
            assertEquals("GGUF must not be enabled in E5-only variant","true",
                evaluate(web,"typeof window.NativeGGUF==='undefined'"));
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
            byte[] hash=MessageDigest.getInstance("SHA-256").digest(q8);
            StringBuilder hex=new StringBuilder();
            for(byte x:hash)hex.append(String.format(java.util.Locale.US,"%02x",x&255));
            byte[] expected=android.util.Base64.decode(
                "DQD59gQDAAIDAwcGB/f4AwX2/f0BAf0IBwb/Bgb99/UI9QQF9/8E/foEAgcEBPoF+P37DAH/CP78+P0FBf/7Aw8HBQP+A/4H+gH9/Qf2Cf4B9/gG+wYG+QL5CQn7//v1/AQL+gX8Bvz4CAb6BPf9BwQI+AT6+AjzB/3/9vn0BQAFBAQCBgECC/v+APz8B/UABf4K/Aj8B/wCAwz39f0CCPf2/QP4/QMD+///DPsKAAD5EAIC/fz2+Pft9QcH+gL/APP/AfkIBwT+/gIIDQL0CPQEBvT8CPQBAH5BQX9A/UBAwb99QH8+vb5+PgBAwn8+/cC+Qb7/gsABQIA//X9CwIJ+AMEAAsHBgvy/fn+/wYH+ff6BQb8/AkJBQgG/vkF+P8C+wP8B+gYFBvoE9vwHA/UI+vsBBwoJ/foFBAEC9fn1+f3+Agf49wQFDPr3C/j99wP+/QEH/AQB+wgA/AsH8AAG+wP+/QcD+fkHBwsEAAUE9/4C/PoJ+v8MBAUF",
                android.util.Base64.DEFAULT);
            // A mismatch report gives numerical evidence instead of disabling the gate.
            assertEquals("Corrupted 384D golden reference",384,expected.length);
            int different=0,maxDelta=0;
            double dot=0,normA=0,normB=0;
            StringBuilder sample=new StringBuilder();
            for(int i=0;i<384;i++){
                int a=q8[i],b=expected[i];
                int delta=Math.abs(a-b);
                if(delta!=0){different++; if(sample.length()<160)sample.append(i).append(':').append(a).append('/').append(b).append(';');}
                maxDelta=Math.max(maxDelta,delta);
                dot+=(double)a*b;normA+=(double)a*a;normB+=(double)b*b;
            }
            double cosine=dot/Math.sqrt(normA*normB);
            android.util.Log.i("E5_CANARY_QA","mismatches="+different+" maxDelta="+maxDelta+
                " cosine="+cosine+" first="+sample);
            assertEquals("Android E5 differs from pinned UINT8 semantic query; different="+different+
                " maxDelta="+maxDelta+" cosine="+cosine+" first="+sample,
                "555bda01cdc0f22dcc4864d75303562e5f7cbb539530aeabc476218b5f0eb26d",
                hex.toString());
        }
    }
}
