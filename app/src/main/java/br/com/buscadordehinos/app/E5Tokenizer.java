package br.com.buscadordehinos.app;
import android.content.res.AssetManager;
import java.io.BufferedInputStream;
import java.io.DataInputStream;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.text.Normalizer;
import java.util.Arrays;
import java.util.HashMap;
import java.util.Map;
final class E5Tokenizer {
    private static final class Piece {
        final int id;final float score;Piece(int i,float s){id=i;score=s;}
    }
    private final Map<String,Piece> vocab=new HashMap<>(300000);
    private int maxLen=1;
    E5Tokenizer(AssetManager assets)throws IOException {
        try(DataInputStream in=new DataInputStream(new BufferedInputStream(assets.open("e5-vocab.bin"),65536))){
            int size=in.readInt();
            if(size<10000||size>1000000)throw new IOException("Vocabulário E5 inválido");
            for(int i=0;i<size;i++){
                int id=in.readInt();float score=in.readFloat();int n=in.readUnsignedShort();
                if(n==0||n>4096)throw new IOException("Token E5 inválido");
                byte[] buffer=new byte[n];in.readFully(buffer);
                String word=new String(buffer,StandardCharsets.UTF_8);
                vocab.put(word,new Piece(id,score));
                maxLen=Math.max(maxLen,Math.min(35,word.codePointCount(0,word.length())));
            }
        }
    }
    int[] encode(String raw,int maxTokens){
        String txt=Normalizer.normalize(String.valueOf(raw),Normalizer.Form.NFKC).replaceAll("\\s+"," ").trim();
        if(txt.isEmpty())return new int[]{0,2};
        String str="▁"+txt.replace(' ','▁');int[] cp=str.codePoints().toArray();int n=cp.length;
        float[] best=new float[n+1];int[] next=new int[n+1],ids=new int[n+1];
        Arrays.fill(best,Float.NEGATIVE_INFINITY);best[n]=0;
        for(int i=n-1;i>=0;i--){
            best[i]=-10000+best[i+1];next[i]=i+1;ids[i]=3;
            StringBuilder b=new StringBuilder();
            for(int j=i;j<n&&j-i<maxLen;j++){
                b.appendCodePoint(cp[j]);Piece x=vocab.get(b.toString());
                if(x==null)continue;
                float val=x.score+best[j+1];
                if(val>best[i]){best[i]=val;next[i]=j+1;ids[i]=x.id;}
            }
        }
        int[] result=new int[Math.min(maxTokens,n+2)];int p=0;result[p++]=0;
        for(int i=0;i<n&&p<result.length-1;){result[p++]=ids[i];i=next[i];}
        result[p++]=2;return Arrays.copyOf(result,p);
    }
}