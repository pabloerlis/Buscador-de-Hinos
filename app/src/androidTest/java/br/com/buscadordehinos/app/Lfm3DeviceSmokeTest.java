package br.com.buscadordehinos.app;

import androidx.test.core.app.ActivityScenario;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import android.content.Context;
import android.content.SharedPreferences;
import android.net.Uri;
import java.util.concurrent.atomic.AtomicReference;
import androidx.test.platform.app.InstrumentationRegistry;
import org.junit.Test;
import org.junit.runner.RunWith;
import java.io.File;
import android.os.SystemClock;
import org.json.JSONObject;
import org.json.JSONArray;
import java.io.ByteArrayOutputStream;
import java.lang.reflect.InvocationTargetException;
import java.lang.reflect.Method;
import java.nio.charset.StandardCharsets;
import static org.junit.Assert.*;

/**
 * Testa o GGUF oficial LFM3 via a biblioteca nativa do APK em Android x86_64.
 * O modelo é transferido apenas ao emulador do CI, nunca empacotado no APK.
 */
@RunWith(AndroidJUnit4.class)
public class Lfm3DeviceSmokeTest {
    @Test public void officialLfm3LoadsAndGeneratesConstrainedOutput() throws Exception {
        assertTrue("O APK deve incluir motor GGUF",BuildConfig.ENABLE_LOCAL_MODELS);
        File gguf=new File(InstrumentationRegistry.getInstrumentation()
            .getTargetContext().getFilesDir(),"qa-lfm3.gguf");
        assertTrue("GGUF oficial ausente no armazenamento privado",gguf.isFile());
        assertTrue("GGUF inesperadamente pequeno (cópia incompleta)",gguf.length()>1_000_000_000L);

        Method load=MainActivity.class.getDeclaredMethod("nativeLoad",String.class,boolean.class);
        Method generate=MainActivity.class.getDeclaredMethod("nativeGenerate",
            byte[].class,byte[].class,int.class,int.class,long[].class);
        Method unload=MainActivity.class.getDeclaredMethod("nativeUnload");
        load.setAccessible(true);
        generate.setAccessible(true);
        unload.setAccessible(true);
        long[] metrics=new long[4];
        try {
            String result=(String)load.invoke(null,gguf.getAbsolutePath(),false);
            assertNotNull("A arquitetura LFM3 não carregou",result);
            assertTrue("Modelo não reportou carregamento: "+result,
                result.contains("GGUF pronto"));
            long simpleStarted=SystemClock.elapsedRealtime();
            byte[] output;
            try {
                output=(byte[])generate.invoke(null,new Object[]{
                    "Responda somente OK.".getBytes(StandardCharsets.UTF_8),
                    "root ::= \"OK\"\n".getBytes(StandardCharsets.UTF_8),
                    12,180_000,metrics
                });
            } catch(InvocationTargetException ex) {
                throw new AssertionError("LFM3 falhou na inferência com gramática GBNF",
                    ex.getCause());
            }
            assertNotNull("LFM3 não retornou texto",output);
            assertEquals("Saída incompatível com gramática GBNF","OK",
                new String(output,StandardCharsets.UTF_8));
            assertTrue("Não houve geração de tokens",metrics[3]>0);
            android.util.Log.i("LFM3_BENCH","BENCHMARK_RESULT case=simple total_ms="
                +(SystemClock.elapsedRealtime()-simpleStarted)+" setup_ms="+metrics[0]
                +" prefill_ms="+metrics[1]+" first_token_ms="+metrics[2]
                +" generated="+metrics[3]);

            JSONObject fixture=fixture("lfm3-comparison.json");
            int timeout="baseline".equals(InstrumentationRegistry.getArguments().getString("benchmarkMode"))
                ?180_000:fixture.getInt("timeoutMs");
            long[] compareMetrics=new long[4];
            long start=SystemClock.elapsedRealtime();
            byte[] compare=(byte[])generate.invoke(null,new Object[]{
                fixture.getString("prompt").getBytes(StandardCharsets.UTF_8),
                fixture.getString("grammar").getBytes(StandardCharsets.UTF_8),fixture.getInt("maxTokens"),timeout,compareMetrics
            });
            long wall=SystemClock.elapsedRealtime()-start;
            assertNotNull("Sem resultado de cinco hinos",compare);
            // Registrar velocidade mesmo que a resposta seja inválida; nunca aprovar por isso.
            android.util.Log.i("LFM3_BENCH","BENCHMARK_RESULT case=compare-five total_ms="+wall
                +" setup_ms="+compareMetrics[0]+" prefill_ms="+compareMetrics[1]
                +" first_token_ms="+compareMetrics[2]+" generated="+compareMetrics[3]);
            JSONArray resultJson=new JSONArray(new String(compare,StandardCharsets.UTF_8));
            assertEquals("A comparação deve selecionar o único trecho com evidência direta",1,resultJson.length());
            assertEquals("A resposta deve referenciar o hino permitido",fixture.getInt("expected"),resultJson.getInt(0));
            assertTrue("Não houve geração real",compareMetrics[3]>0);

            if (!"baseline".equals(InstrumentationRegistry.getArguments().getString("benchmarkMode"))) {
                verifyReview(generate);
                verifyChat(generate);
            }
            android.util.Log.i("LFM3_SMOKE_SUCCESS","official QAD Q4_0, tokens="
                +metrics[3]+", prefill_ms="+metrics[1]+", first_token_ms="+metrics[2]);
        } finally {
            unload.invoke(null);
        }
        if (!"baseline".equals(InstrumentationRegistry.getArguments().getString("benchmarkMode"))) {
            verifyAutomaticLoading(gguf);
        }
    }

    private static void verifyAutomaticLoading(File gguf) throws Exception {
        Context context=InstrumentationRegistry.getInstrumentation().getTargetContext();
        SharedPreferences prefs=context.getSharedPreferences("hinos_local_llm",Context.MODE_PRIVATE);
        Uri uri=Uri.parse("content://br.com.buscadordehinos.qa.unavailable/qa-lfm3.gguf");
        long size=gguf.length();
        Method cacheKey=MainActivity.class.getDeclaredMethod("cacheKey",Uri.class,long.class);
        cacheKey.setAccessible(true);
        File cache=new File(context.getFilesDir(),"gguf-cache");
        assertTrue(cache.isDirectory()||cache.mkdirs());
        File cached=new File(cache,"gguf-"+cacheKey.invoke(null,uri,size)+".gguf");
        assertTrue("Não foi possível preparar a cópia privada de teste",gguf.renameTo(cached));
        assertTrue(prefs.edit().putString("model_uri",uri.toString()).putString("model_display_name","qa-lfm3.gguf")
            .putLong("model_bytes",size).commit());
        try(ActivityScenario<MainActivity> activity=ActivityScenario.launch(MainActivity.class)){
            awaitAutomaticLoad(activity);
            activity.recreate();
            awaitAutomaticLoad(activity);
            assertEquals(size,cached.length());
            android.util.Log.i("LFM3_BENCH","AUTOLOAD_RESULT ready_after_create=true ready_after_recreate=true private_cache=true");
        }finally{
            prefs.edit().clear().commit();
            assertTrue("Não foi possível devolver o modelo temporário ao runner",cached.renameTo(gguf));
        }
    }

    private static void awaitAutomaticLoad(ActivityScenario<MainActivity> activity) throws Exception {
        long until=SystemClock.elapsedRealtime()+60000;
        while(SystemClock.elapsedRealtime()<until){
            AtomicReference<String> status=new AtomicReference<>();
            activity.onActivity(screen->status.set(screen.new ModelBridge().status()));
            JSONObject result=new JSONObject(status.get());
            assertNotEquals("Erro ao restaurar modelo: "+result.optString("lastError"),"error",result.optString("phase"));
            if(result.optBoolean("loaded") && !result.optBoolean("busy"))return;
            SystemClock.sleep(250);
        }
        fail("O GGUF salvo não carregou automaticamente");
    }

    private static JSONObject fixture(String name) throws Exception {
        try (java.io.InputStream input=InstrumentationRegistry.getInstrumentation()
                .getContext().getAssets().open(name)) {
            ByteArrayOutputStream data=new ByteArrayOutputStream();
            byte[] chunk=new byte[4096];
            for (int size; (size=input.read(chunk))!=-1;) data.write(chunk,0,size);
            return new JSONObject(new String(data.toByteArray(),StandardCharsets.UTF_8));
        }
    }

    private static void verifyChat(Method generate) throws Exception {
        JSONArray requests=fixture("lfm3-chat.json").getJSONArray("requests");
        long start=SystemClock.elapsedRealtime();
        for(int i=0;i<requests.length();i++){
            JSONObject item=requests.getJSONObject(i);
            long[] metrics=new long[4];
            byte[] answer=(byte[])generate.invoke(null,new Object[]{
                item.getString("prompt").getBytes(StandardCharsets.UTF_8),
                item.getString("grammar").getBytes(StandardCharsets.UTF_8),
                item.getInt("maxTokens"),item.getInt("timeoutMs"),metrics
            });
            assertNotNull(answer);
            assertTrue("O chat precisa gerar tokens",metrics[3]>0);
            JSONArray result=new JSONArray(new String(answer,StandardCharsets.UTF_8).trim());
            assertEquals(1,result.length());
            if(i==0) {
                String query=result.getString(0).toLowerCase(java.util.Locale.ROOT);
                assertTrue("O chat deve entender o contexto de perda: "+query,query.contains("perda")||query.contains("luto"));
            }else assertEquals("O destaque deve corresponder ao trecho direto",2,result.getInt(0));
        }
        android.util.Log.i("LFM3_BENCH","CHAT_RESULT rewrite=true grounded_pick=true total_ms="+(SystemClock.elapsedRealtime()-start));
    }

    private static void verifyReview(Method generate) throws Exception {
        JSONObject request=fixture("lfm3-review.json");
        int budget=request.getInt("timeoutMs");

        long start=SystemClock.elapsedRealtime();
        int totalTokens=0;
        long totalSetup=0, totalPrefill=0, firstToken=0;
        JSONArray requests=request.getJSONArray("requests");
        assertEquals("Quatro hinos precisam ser analisados",4,requests.length());
        String[] expected={"não","sim","não","não"};
        for (int i=0;i<requests.length();i++) {
            JSONObject item=requests.getJSONObject(i);
            long[] metrics=new long[4];
            int remaining=budget-(int)(SystemClock.elapsedRealtime()-start);
            assertTrue("A revisão ultrapassou o tempo disponível",remaining>=1000);
            byte[] output=(byte[])generate.invoke(null,new Object[]{
                item.getString("prompt").getBytes(StandardCharsets.UTF_8),
                item.getString("grammar").getBytes(StandardCharsets.UTF_8),item.getInt("maxTokens"),remaining,metrics
            });
            assertNotNull("Sem resultado da revisão",output);
            assertTrue("A revisão precisa gerar tokens",metrics[3]>0);
            assertEquals("Classificação do hino sintético "+(i+1),expected[i],new String(output,StandardCharsets.UTF_8).trim());
            if (i==0) firstToken=metrics[2];
            totalSetup+=metrics[0];
            totalPrefill+=metrics[1];
            totalTokens+=metrics[3];
        }
        long wall=SystemClock.elapsedRealtime()-start;
        android.util.Log.i("LFM3_BENCH","BENCHMARK_RESULT case=review-four total_ms="+wall
            +" setup_ms="+totalSetup+" prefill_ms="+totalPrefill
            +" first_token_ms="+firstToken+" generated="+totalTokens);
    }
}
