package br.com.buscadordehinos.app;
import java.io.*;
import java.net.URL;
import java.security.MessageDigest;
import java.util.Arrays;
public final class HarrierPackageTest {
    static void check(boolean ok){if(!ok)throw new AssertionError();}
    static void reject(Throwing run)throws Exception{
        try{run.run();}catch(IOException expected){return;}throw new AssertionError("Expected IOException");
    }
    interface Throwing {void run()throws Exception;}
    public static void main(String[] args)throws Exception{
        long total=0;for(HarrierPackage.Entry e:HarrierPackage.ENTRIES){total+=e.bytes;check(e.sha.matches("[0-9a-f]{64}"));check(HarrierPackage.trusted(new URL(e.url)));}
        check(total==HarrierPackage.TOTAL_BYTES);
        byte[] data={1,2,3,4};String hash=HarrierPackage.hex(MessageDigest.getInstance("SHA-256").digest(data));
        ByteArrayOutputStream out=new ByteArrayOutputStream();long[] progress={0};
        HarrierPackage.copyVerified(new ByteArrayInputStream(data),out,4,hash,()->false,n->progress[0]=n);
        check(Arrays.equals(data,out.toByteArray()));check(progress[0]==4);
        reject(()->HarrierPackage.copyVerified(new ByteArrayInputStream(data),new ByteArrayOutputStream(),3,hash,()->false,n->{}));
        reject(()->HarrierPackage.copyVerified(new ByteArrayInputStream(data),new ByteArrayOutputStream(),5,hash,()->false,n->{}));
        reject(()->HarrierPackage.copyVerified(new ByteArrayInputStream(data),new ByteArrayOutputStream(),4,"0".repeat(64),()->false,n->{}));
        reject(()->HarrierPackage.copyVerified(new ByteArrayInputStream(data),new ByteArrayOutputStream(),4,hash,()->true,n->{}));
        check(!HarrierPackage.trusted(new URL("http://huggingface.co")));
        check(!HarrierPackage.trusted(new URL("https://huggingface.co.attacker.example")));
        check(!HarrierPackage.trusted(new URL("https://user@huggingface.co")));
        check(!HarrierPackage.trusted(new URL("https://huggingface.co:8443")));
        System.out.println("Harrier package: tamanho, SHA256, cancelamento, origens e limites OK");
    }
}
