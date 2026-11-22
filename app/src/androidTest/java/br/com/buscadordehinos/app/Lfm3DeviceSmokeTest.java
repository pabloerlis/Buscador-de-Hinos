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
            String compareText=new String(compare,StandardCharsets.UTF_8);
            android.util.Log.i("LFM3_BENCH","MODEL_RESPONSE case=compare-five output="+compareText);
            JSONObject resultJson=new JSONObject(compareText);

            // PROVA DIAGNÓSTICA SEPARADA: verificar se o modelo consegue
            // avaliar TODOS os candidatos, sem o viés do primeiro ID.
            // Não substituir nem relaxar o assert do reranking original.
            String scorePrompt="Tarefa de relevância narrativa. Para CADA candidato, atribua nota "
                +"0: outro assunto, 1: apenas tema comum, 2: parte da história, "
                +"3: a sequência completa de acontecimentos. "
                +"História alvo: o filho sai da casa do pai; arrepende-se; regressa; "
                +"o pai o acolhe e perdoa. Compare os cinco candidatos. "
                +"Candidatos: 1 nascimento do menino em manjedoura com anjos; "
                +"2 gratidão geral, sem história de saída e retorno; "
                +"3 um filho deixa o lar e se afasta, na última estrofe se arrepende, "
                +"retorna e recebe acolhimento e perdão do pai; "
                +"4 tempestade e socorro no mar; 5 ressurreição e esperança eterna. "
                +"Retorne SOMENTE as notas 0,1,2 ou 3 para TODOS os cinco IDs no JSON. "
                +"Cada nota deve avaliar seu próprio candidato, não a posição.";
            String scoreGrammar="root ::= "+JSONObject.quote("{\"1\":") +" score "
                +JSONObject.quote(",\"2\":") +" score "
                +JSONObject.quote(",\"3\":") +" score "
                +JSONObject.quote(",\"4\":") +" score "
                +JSONObject.quote(",\"5\":") +" score "
                +JSONObject.quote("}") +"\n"
                +"score ::= \"0\" | \"1\" | \"2\" | \"3\"\n";
            long[] scoreMetrics=new long[4];
            long scoreStart=SystemClock.elapsedRealtime();
            try {
                byte[] scores=(byte[])generate.invoke(null,new Object[]{
                    scorePrompt.getBytes(StandardCharsets.UTF_8),
                    scoreGrammar.getBytes(StandardCharsets.UTF_8),64,180_000,scoreMetrics
                });
                String scoreText=new String(scores,StandardCharsets.UTF_8);
                android.util.Log.i("LFM3_BENCH","BENCHMARK_RESULT case=score-five total_ms="
                    +(SystemClock.elapsedRealtime()-scoreStart)+" setup_ms="+scoreMetrics[0]
                    +" prefill_ms="+scoreMetrics[1]+" first_token_ms="+scoreMetrics[2]
                    +" generated="+scoreMetrics[3]);
                android.util.Log.i("LFM3_BENCH","MODEL_RESPONSE case=score-five output="+scoreText);
                JSONObject scoreJson=new JSONObject(scoreText);
                int winningId=1;
                for(int i=2;i<=5;i++)if(scoreJson.getInt(String.valueOf(i))>
                    scoreJson.getInt(String.valueOf(winningId)))winningId=i;
                android.util.Log.i("LFM3_BENCH","SCORE_DIAGNOSTIC chosen="+winningId
                    +" expected=3 (non-blocking; original direct-selection assertion stays blocking)");
            } catch (Exception scoringError) {
                android.util.Log.e("LFM3_BENCH","SCORE_DIAGNOSTIC_ERROR "
                    +scoringError.toString());
            }

            // Diagnósticos sem gramática e com classificações binárias: isolam
            // possível viés da lista/gramática sem abrandar o teste bloqueante.
            String freePrompt="Analise os eventos, não apenas palavras. História: "
                +"um filho abandona o pai, arrepende-se, volta e é acolhido e perdoado. "
                +"Candidatos: (1) Noite de Paz fala do nascimento de Jesus e anjos; "
                +"(2) Gratidão agradece a Deus; (3) Um dia eu quis te deixar "
                +"começa com saída do filho e termina com o retorno e perdão do pai; "
                +"(4) No Mar fala de tempestade; (5) Manhã Gloriosa fala da ressurreição. "
                +"Qual candidato realmente corresponde à história? "
                +"Explique por que o candidato 1 é ou não é adequado e indique o número correto.";
            long[] freeMetrics=new long[4];
            long freeStarted=SystemClock.elapsedRealtime();
            try {
                byte[] free=(byte[])generate.invoke(null,new Object[]{
                    freePrompt.getBytes(StandardCharsets.UTF_8),
                    new byte[0],96,120_000,freeMetrics
                });
                android.util.Log.i("LFM3_BENCH","BENCHMARK_RESULT case=free-reason total_ms="
                    +(SystemClock.elapsedRealtime()-freeStarted)
                    +" setup_ms="+freeMetrics[0]+" prefill_ms="+freeMetrics[1]
                    +" first_token_ms="+freeMetrics[2]+" generated="+freeMetrics[3]);
                android.util.Log.i("LFM3_BENCH","MODEL_RESPONSE case=free-reason output="
                    +new String(free,StandardCharsets.UTF_8).replace('\\n',' '));
            } catch(Exception e) {
                android.util.Log.e("LFM3_BENCH","FREE_REASON_DIAGNOSTIC_ERROR "+e.toString());
            }
            String[] binaryCases={
                "Noite de Paz: nascimento de Jesus, anjos e manjedoura.",
                "Um dia eu quis te deixar: filho abandona o pai, arrepende-se, "
                    +"regressa e recebe perdão do pai."
            };
            String binaryGrammar="root ::= \\"S\\" | \\"N\\"\\n";
            for(int i=0;i<binaryCases.length;i++){
                String binaryPrompt="História alvo: filho abandona a casa do pai, "
                    +"arrepende-se, retorna e é acolhido e perdoado. "
                    +"Candidato: "+binaryCases[i]
                    +" O candidato relata a MESMA sequência completa? "
                    +"Responda S se SIM ou N se NÃO.";
                long[] binaryMetrics=new long[4];
                long binaryStarted=SystemClock.elapsedRealtime();
                try {
                    byte[] binary=(byte[])generate.invoke(null,new Object[]{
                        binaryPrompt.getBytes(StandardCharsets.UTF_8),
                        binaryGrammar.getBytes(StandardCharsets.UTF_8),
                        8,90_000,binaryMetrics
                    });
                    android.util.Log.i("LFM3_BENCH","BENCHMARK_RESULT case=binary-"+i
                        +" total_ms="+(SystemClock.elapsedRealtime()-binaryStarted)
                        +" setup_ms="+binaryMetrics[0]+" prefill_ms="+binaryMetrics[1]
                        +" first_token_ms="+binaryMetrics[2]
                        +" generated="+binaryMetrics[3]);
                    android.util.Log.i("LFM3_BENCH","MODEL_RESPONSE case=binary-"+i
                        +" expected="+(i==0?"N":"S")+" output="
                        +new String(binary,StandardCharsets.UTF_8));
                } catch(Exception e) {
                    android.util.Log.e("LFM3_BENCH","BINARY_DIAGNOSTIC_ERROR case="+i
                        +" error="+e.toString());
                }
            }

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
