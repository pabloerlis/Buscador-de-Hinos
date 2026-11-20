package br.com.buscadordehinos.app;
import android.content.res.AssetManager;
import java.util.Base64;
import java.util.Arrays;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
public final class E5TokenizerIntegration {
    public static void main(String[] args)throws Exception{
        if(args.length!=2)throw new IllegalArgumentException("assets dir, expected TSV");
        E5Tokenizer tokenizer=new E5Tokenizer(new AssetManager(args[0]));
        int passed=0;
        for(String line:Files.readAllLines(Path.of(args[1]),StandardCharsets.UTF_8)){
            if(line.isEmpty())continue;
            String[] parts=line.split("\\t");
            if(parts.length!=2)throw new IllegalArgumentException("Invalid tokenizer test case");
            String query=new String(Base64.getDecoder().decode(parts[0]),StandardCharsets.UTF_8);
            String[] cells=parts[1].split(",");
            int[] expected=new int[cells.length];
            for(int i=0;i<cells.length;i++)expected[i]=Integer.parseInt(cells[i]);
            int[] actual=tokenizer.encode(query,192);
            if(!Arrays.equals(expected,actual)){
                throw new AssertionError("Android E5 tokenizer diverges from the source model for: "+query+
                    " expected="+Arrays.toString(expected)+" actual="+Arrays.toString(actual));
            }
            passed++;
        }
        if(passed<20)throw new AssertionError("Insufficient tokenizer golden cases: "+passed);
        System.out.println("TOKENIZER ANDROID: "+passed+" casos idênticos ao tokenizer original.");
    }
}
