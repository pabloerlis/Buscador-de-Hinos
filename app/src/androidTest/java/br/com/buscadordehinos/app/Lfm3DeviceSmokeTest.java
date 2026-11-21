package br.com.buscadordehinos.app;

import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import org.junit.Test;
import org.junit.runner.RunWith;
import java.io.File;
import android.os.SystemClock;
import org.json.JSONObject;
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

        Method load=MainActivity.class.getDeclaredMethod("nativeLoad",String.class);
        Method generate=MainActivity.class.getDeclaredMethod("nativeGenerate",
            byte[].class,byte[].class,int.class,int.class,long[].class);
        Method unload=MainActivity.class.getDeclaredMethod("nativeUnload");
        load.setAccessible(true);
        generate.setAccessible(true);
        unload.setAccessible(true);
        long[] metrics=new long[4];
        try {
            String result=(String)load.invoke(null,gguf.getAbsolutePath());
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

            // Cinco candidatos em posições distintas. A resposta correta depende da
            // sequência narrativa completa, não da simples palavra "filho".
            String narrative="TAREFA: escolher UM hino que CONTA A HISTÓRIA de Lucas 15:11-32, o filho pródigo. "
                +"Critério: a mesma sequência de eventos: deixar o pai, arrepender-se, voltar e ser acolhido pelo pai. "
                +"Gratidão genérica não é a história; palavras religiosas isoladas não bastam. "
                +"Hinos candidatos: "
                +"1: Noite de Paz — descreve o nascimento de Jesus, manjedoura e anjos. "
                +"2: Gratidão — canta louvor e agradecimento geral, sem retorno do filho ao pai. "
                +"3: Um dia eu quis te deixar — primeira estrofe, o filho deixa o lar e se afasta; "
                +"ÚLTIMA ESTROFE, ele se arrepende, retorna ao pai, que o acolhe e perdoa. "
                +"4: No Mar — tempestade e socorro durante uma viagem. "
                +"5: Manhã Gloriosa — ressurreição e esperança na vida eterna. "
                +"Qual candidato tem a narrativa INTEIRA? Responda APENAS um JSON válido "
                +"com id e motivo de 8 a 24 letras minúsculas, sem acentos.";
            String gbnf="root ::= \"{\\\"id\\\":\" (\"1\" | \"2\" | \"3\" | \"4\" | \"5\") \",\\\"motivo\\\":\\\"\" [a-z ]{8,24} \"\\\"}\"\n";
            long[] compareMetrics=new long[4];
            long start=SystemClock.elapsedRealtime();
            byte[] compare=(byte[])generate.invoke(null,new Object[]{
                narrative.getBytes(StandardCharsets.UTF_8),
                gbnf.getBytes(StandardCharsets.UTF_8),120,180_000,compareMetrics
            });
            long wall=SystemClock.elapsedRealtime()-start;
            assertNotNull("Sem resultado de cinco hinos",compare);
            // Registrar velocidade mesmo que a resposta seja inválida; nunca aprovar por isso.
            android.util.Log.i("LFM3_BENCH","BENCHMARK_RESULT case=compare-five total_ms="+wall
                +" setup_ms="+compareMetrics[0]+" prefill_ms="+compareMetrics[1]
                +" first_token_ms="+compareMetrics[2]+" generated="+compareMetrics[3]);
            JSONObject resultJson=new JSONObject(new String(compare,StandardCharsets.UTF_8));
            assertEquals("Reranking errou a narrativa do filho pródigo",3,resultJson.getInt("id"));
            assertTrue("Justificativa curta ausente",resultJson.getString("motivo").trim().length()>=8);
            assertTrue("Não houve geração real",compareMetrics[3]>0);

            android.util.Log.i("LFM3_SMOKE_SUCCESS","official QAD Q4_0, tokens="
                +metrics[3]+", prefill_ms="+metrics[1]+", first_token_ms="+metrics[2]);
        } finally {
            unload.invoke(null);
        }
    }
}
