package br.com.buscadordehinos.app;

import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import org.junit.Test;
import org.junit.runner.RunWith;
import java.io.File;
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
            android.util.Log.i("LFM3_SMOKE_SUCCESS","official QAD Q4_0, tokens="
                +metrics[3]+", prefill_ms="+metrics[1]+", first_token_ms="+metrics[2]);
        } finally {
            unload.invoke(null);
        }
    }
}
