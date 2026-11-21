package br.com.buscadordehinos.app;

import android.webkit.WebView;
import android.view.ViewGroup;
import androidx.test.core.app.ActivityScenario;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import org.junit.Test;
import org.junit.runner.RunWith;
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
                "return a.versionName==='2.6.6' && a.developer==='Pablo Erlis' && " +
                "a.versionCode===25;}catch(e){return false}})()");
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
                    "window.NativeVector.embed('e5-qa','mulher doente tocou nas vestes de Cristo');true;"));
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
        }
    }
}
