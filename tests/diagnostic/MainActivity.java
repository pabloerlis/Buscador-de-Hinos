package br.com.buscadordehinos.app;

import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;

public final class MainActivity {
    static native String nativeLoad(String path, boolean packed);
    static native void nativeUnload();
    static native byte[] nativeGenerate(byte[] prompt, byte[] grammar, int maxTokens, int timeoutMs, long[] metrics);
    public static void main(String[] args) throws Exception {
        System.load(args[0]);
        String loaded=nativeLoad(args[1],false);
        if (!loaded.contains("GGUF pronto")) throw new IllegalStateException("Modelo QAD não carregado");
        Path dir=Path.of("/tmp/hinos-review");
        List<String> rows=new ArrayList<>();
        long started=System.nanoTime();
        try {
            for (int i=0; i<4; i++) {
                byte[] prompt=Files.readAllBytes(dir.resolve("input-"+i+".txt"));
                byte[] grammar=Files.readAllBytes(dir.resolve("grammar-"+i+".txt"));
                long[] stats=new long[4];
                int remaining=30_000-(int)((System.nanoTime()-started)/1_000_000);
                if (remaining<1000) throw new IllegalStateException("Tempo de revisão esgotado");
                long begin=System.nanoTime();
                byte[] answer=nativeGenerate(prompt,grammar,5,remaining,stats);
                String grade=new String(answer,StandardCharsets.UTF_8).trim();
                if (!grade.equals("sim")&&!grade.equals("não")) throw new IllegalStateException("Resposta inesperada");
                rows.add(grade+"\t"+((System.nanoTime()-begin)/1_000_000));
            }
        } finally {
            nativeUnload();
        }
        Files.write(dir.resolve("grades.tsv"),rows);
    }
}
