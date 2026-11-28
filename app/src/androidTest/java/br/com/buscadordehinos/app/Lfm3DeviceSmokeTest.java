package br.com.buscadordehinos.app;

import androidx.test.ext.junit.runners.AndroidJUnit4;
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

            JSONObject fixture;
            try (java.io.InputStream input=InstrumentationRegistry.getInstrumentation()
                    .getContext().getAssets().open("lfm3-comparison.json")) {
                ByteArrayOutputStream data=new ByteArrayOutputStream();
                byte[] chunk=new byte[4096];
                for (int size; (size=input.read(chunk))!=-1;) data.write(chunk,0,size);
                fixture=new JSONObject(new String(data.toByteArray(),StandardCharsets.UTF_8));
            }
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
                JSONObject chatFixture;
                try (java.io.InputStream input=InstrumentationRegistry.getInstrumentation()
                        .getContext().getAssets().open("lfm3-chat-decision.json")) {
                    ByteArrayOutputStream data=new ByteArrayOutputStream();
                    byte[] chunk=new byte[4096];
                    for (int size; (size=input.read(chunk))!=-1;) data.write(chunk,0,size);
                    chatFixture=new JSONObject(new String(data.toByteArray(),StandardCharsets.UTF_8));
                }
                long[] chatMetrics=new long[4];
                long chatStart=SystemClock.elapsedRealtime();
                byte[] decision=(byte[])generate.invoke(null,new Object[]{
                    chatFixture.getString("prompt").getBytes(StandardCharsets.UTF_8),
                    chatFixture.getString("grammar").getBytes(StandardCharsets.UTF_8),
                    chatFixture.getInt("maxTokens"),chatFixture.getInt("timeoutMs"),chatMetrics
                });
                assertNotNull("LFM3 não respondeu ao roteador P4",decision);
                String generated=new String(decision,StandardCharsets.UTF_8).trim();
                JSONArray parsed=new JSONArray("["+generated+"]");
                assertEquals("Roteador deveria emitir apenas uma ação",1,parsed.length());
                String action=parsed.getString(0);
                assertEquals("LFM3 não pediu a busca explícita por hinos",
                    chatFixture.getString("expected"),action);
                assertTrue("Sem tokens do roteador de chat",chatMetrics[3]>0);
                android.util.Log.i("LFM3_BENCH","BENCHMARK_RESULT case=chat-router total_ms="
                    +(SystemClock.elapsedRealtime()-chatStart)+" setup_ms="+chatMetrics[0]
                    +" prefill_ms="+chatMetrics[1]+" first_token_ms="+chatMetrics[2]
                    +" generated="+chatMetrics[3]+" action="+action);

                JSONObject answerFixture;
                try (java.io.InputStream input=InstrumentationRegistry.getInstrumentation()
                        .getContext().getAssets().open("lfm3-chat-answer.json")) {
                    ByteArrayOutputStream data=new ByteArrayOutputStream();
                    byte[] chunk=new byte[4096];
                    for (int size; (size=input.read(chunk))!=-1;) data.write(chunk,0,size);
                    answerFixture=new JSONObject(new String(data.toByteArray(),StandardCharsets.UTF_8));
                }
                long[] answerMetrics=new long[4];
                long answerStart=SystemClock.elapsedRealtime();
                byte[] answer=(byte[])generate.invoke(null,new Object[]{
                    answerFixture.getString("prompt").getBytes(StandardCharsets.UTF_8),
                    answerFixture.getString("grammar").getBytes(StandardCharsets.UTF_8),
                    answerFixture.getInt("maxTokens"),answerFixture.getInt("timeoutMs"),answerMetrics
                });
                assertNotNull("LFM3 não respondeu ao segundo estágio do chat",answer);
                assertTrue("Chat não produziu resposta em linguagem natural",
                    new String(answer,StandardCharsets.UTF_8).trim().length()>3);
                assertTrue("Sem tokens de resposta",answerMetrics[3]>0);
                android.util.Log.i("LFM3_BENCH","BENCHMARK_RESULT case=chat-answer total_ms="
                    +(SystemClock.elapsedRealtime()-answerStart)+" prefill_ms="+answerMetrics[1]
                    +" first_token_ms="+answerMetrics[2]+" generated="+answerMetrics[3]);
            }

            android.util.Log.i("LFM3_SMOKE_SUCCESS","official QAD Q4_0, tokens="
                +metrics[3]+", prefill_ms="+metrics[1]+", first_token_ms="+metrics[2]);
        } finally {
            unload.invoke(null);
        }
    }
}
