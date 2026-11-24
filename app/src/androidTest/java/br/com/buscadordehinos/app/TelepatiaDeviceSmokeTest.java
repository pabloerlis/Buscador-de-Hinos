package br.com.buscadordehinos.app;

import android.content.Context;
import android.webkit.WebView;
import android.view.ViewGroup;
import androidx.test.core.app.ActivityScenario;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.json.JSONObject;
import java.io.File;
import java.io.FileInputStream;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;
import static org.junit.Assert.*;

/** Testes no emulador offline usando o modelo Telepatia externo completo.
 * Exige ZIP e entrada de referencia reais, transferidos via adb APÓS instalar APK.
 * Falha fechada caso a inferencia, a interface ou a integridade do modelo falhe.
 */
@RunWith(AndroidJUnit4.class)
public final class TelepatiaDeviceSmokeTest {
    private String eval(WebView web,String script)throws Exception{
        CountDownLatch latch=new CountDownLatch(1);
        AtomicReference<String> value=new AtomicReference<>("");
        InstrumentationRegistry.getInstrumentation().runOnMainSync(()->
            web.evaluateJavascript(script,answer->{value.set(answer);latch.countDown();}));
        assertTrue("WebView callback timed out",latch.await(25,TimeUnit.SECONDS));
        return value.get();
    }

    @Test public void telepatiaExternalModelExecutesRealInferenceOffline()throws Exception{
        Context app=InstrumentationRegistry.getInstrumentation().getTargetContext();
        assertTrue("Compile E5-enabled Android",BuildConfig.ENABLE_LOCAL_EMBEDDINGS);
        assertFalse("LFM3 GGUF must not be built",BuildConfig.ENABLE_LOCAL_MODELS);
        File zip=new File(app.getExternalFilesDir(null),"telepatia.zip");
        File golden=new File(app.getExternalFilesDir(null),"telepatia-golden.json");
        assertTrue("NLI checkpoint ZIP not pushed to Android",zip.isFile()&&zip.length()>400_000_000L);
        assertTrue("No independent real-token fixture on Android",golden.isFile()&&golden.length()>64);
        byte[] fixtureBytes=new byte[(int)golden.length()];
        try(FileInputStream in=new FileInputStream(golden)){
            int used=0,n;
            while(used<fixtureBytes.length&&(n=in.read(fixtureBytes,used,fixtureBytes.length-used))>0)used+=n;
            assertEquals(fixtureBytes.length,used);
        }
        JSONObject fixture=new JSONObject(new String(fixtureBytes,StandardCharsets.UTF_8));
        long imported=System.nanoTime();
        try(TelepatiaNliEngine model=new TelepatiaNliEngine(app)){
            try(FileInputStream input=new FileInputStream(zip)){model.install(input);}
            assertTrue("External NLI files not installed",model.isInstalled());
            model.load();
            assertTrue("ORT Telepatia not loaded",model.isLoaded());
            assertEquals(64,model.modelSha().length());
            JSONObject result=model.classify(fixture);
            assertEquals("Actual Telepatia ONNX expected entailment label",
                "entailment",result.getString("label"));
            assertEquals(3,result.getJSONArray("logits").length());
            assertTrue("Invalid inference duration",result.getLong("ms")>=0);
            android.util.Log.i("TELEPATIA_NLI_QA","real_inference=passed,elapsed_ms="+
                ((System.nanoTime()-imported)/1_000_000L)+",onnx_ms="+result.getLong("ms"));
        }
    }

    @Test public void androidSearchSliderUiUsesNativeNliButNoGguf()throws Exception{
        try(ActivityScenario<MainActivity> activity=ActivityScenario.launch(MainActivity.class)){
            AtomicReference<WebView> view=new AtomicReference<>();
            activity.onActivity(a->{
                ViewGroup root=a.findViewById(android.R.id.content);
                assertNotNull(root);
                assertTrue(root.getChildAt(0) instanceof WebView);
                view.set((WebView)root.getChildAt(0));
            });
            assertNotNull(view.get());
            boolean ready=false;
            for(int retry=0;retry<40;retry++){
                if("true".equals(eval(view.get(),"Boolean(window.NativeNLI&&typeof TelepatiaSequence!=='undefined'&&document.getElementById('nli-status')&&document.getElementById('tuner-topic'))"))){
                    ready=true;break;
                }
                Thread.sleep(1000);
            }
            assertTrue("Telepatia WebView client not loaded",ready);
            assertEquals("Seleção do ZIP não está visível na tela inicial","true",
                eval(view.get(),"(()=>{const welcome=document.getElementById('welcome-panel');"
                    +"const picker=document.getElementById('nli-select-home');"
                    +"const settings=document.getElementById('nli-select-settings');"
                    +"const results=document.getElementById('results-panel');"
                    +"return !!welcome&&!!picker&&!!settings&&!!results"
                    +"&&!welcome.classList.contains('hidden')"
                    +"&&results.classList.contains('hidden')"
                    +"&&window.getComputedStyle(picker).display!=='none'"
                    +"&&picker.getAttribute('data-nli-select')!==null"
                    +"&&settings.getAttribute('data-nli-select')!==null"
                    +"&&!picker.disabled})()"));
            assertEquals("Status do Telepatia não aparece antes da pesquisa","true",
                eval(view.get(),"(()=>{const a=document.getElementById('nli-status-home');"
                    +"const b=document.getElementById('nli-status-settings');"
                    +"return !!a&&!!b&&a.textContent.length>5&&a.textContent===b.textContent})()"));
            assertEquals("Legacy GGUF runtime must be disabled","true",
                eval(view.get(),"!Boolean(window.NativeGGUF)"));
            assertEquals("NLI bridge status invalid","true",
                eval(view.get(),"(()=>{const s=JSON.parse(window.NativeNLI.status());return s.available&&s.model==='telepatia-ai/laya-pt-es-nli';})()"));
            assertEquals("On-device slider did not persist","true",eval(view.get(),
                "(()=>{const x=document.getElementById('tuner-topic');x.value='30';x.dispatchEvent(new Event('input',{bubbles:true}));"
                 +"const saved=JSON.parse(localStorage.getItem('hinos-semantic-tuner-v1'));"
                 +"return saved.topic===30&&document.getElementById('tuner-topic-value').textContent==='30%';})()"));
        }
    }
}