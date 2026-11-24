package br.com.buscadordehinos.app;

import java.io.*;
import java.net.*;
import java.security.*;
import java.util.UUID;

/** Fixed-source package installer; no model execution or user-supplied URLs. */
final class HarrierPackage {
    private static final String HF="https://huggingface.co/onnx-community/harrier-oss-v1-0.6b-ONNX/resolve/dbaf6767003608562dd5b744bc443656a29c45bd/";
    private static final String DATA="https://raw.githubusercontent.com/pabloerlis/Buscador-de-Hinos/d4da3321702e048acae32c1cfca1223d0159b45d/data/embeddings/harrier-600m-q4f16/";
    static final class Entry {
        final String path,url,sha;
        final long bytes;
        Entry(String path,String base,long bytes,String sha){this.path=path;this.url=base+path;this.bytes=bytes;this.sha=sha;}
    }
    static final Entry[] ENTRIES={
        new Entry("onnx/model_q4f16.onnx",HF,376930L,"164230246e40d0249dfefe2901cafd071e1d116e96aa0f9b7fa2da1284fbdbb1"),
        new Entry("onnx/model_q4f16.onnx_data",HF,353058816L,"4c431be6a2456467e96bee8e9080464e2d0a4352c8de77639deee87bac69dd1d"),
        new Entry("tokenizer.json",HF,9117473L,"2320ebaed2032c36f5c539cb8531d0642a10024e164f1d81ebbe163b259e3ba5"),
        new Entry("tokenizer_config.json",HF,4650L,"e1c8a5341a350885510d652a3a303beabf3a76ef745af6c6b4c3f0d815ccfb5c"),
        new Entry("config.json",HF,1530L,"c55e075ac57223f7442ef1755051e9bd212e0d4ff2ed68694037f5a21dba7eeb"),
        new Entry("index.json",DATA,4034468L,"faa0adcaa299f9657e524d3f39a6617c4a46f632f49b1699a7b80c54c17ad664"),
        new Entry("manifest.json",DATA,1863L,"1f27860f1c7c7a83c03f98125f17343b2964fd382ea7388712c8f1a36070c22b")
    };
    static final long TOTAL_BYTES=366595730L;
    static final long REQUIRED_FREE=TOTAL_BYTES+32L*1024*1024;
    interface Cancel {boolean cancelled();}
    interface Progress {void bytes(long bytes);}
    private static HarrierPackage instance;
    static synchronized HarrierPackage get(File filesDir){
        if(instance==null)instance=new HarrierPackage(filesDir);
        return instance;
    }
    private final File root,installed;
    private volatile String phase="absent",message="Pacote não instalado.";
    private volatile long downloaded=0;
    private volatile boolean cancel;
    private volatile HttpURLConnection active;
    private HarrierPackage(File filesDir){
        root=new File(filesDir,"harrier");installed=new File(root,"v1");
        if(hasFiles(installed)){phase="installed";message="Arquivos instalados. Motor Android ainda não ativado.";downloaded=TOTAL_BYTES;}
    }
    static boolean hasFiles(File dir){
        if(!dir.isDirectory())return false;
        for(Entry e:ENTRIES){File f=new File(dir,e.path);if(!f.isFile()||f.length()!=e.bytes)return false;}
        return new File(dir,".verified").isFile();
    }
    static String hex(byte[] bytes){StringBuilder b=new StringBuilder();for(byte x:bytes)b.append(String.format(java.util.Locale.ROOT,"%02x",x&255));return b.toString();}
    static void copyVerified(InputStream input,OutputStream output,long expected,String hash,Cancel cancel,Progress progress)throws Exception{
        MessageDigest digest=MessageDigest.getInstance("SHA-256");
        byte[] buf=new byte[65536];long size=0;
        while(true){
            if(cancel.cancelled())throw new InterruptedIOException("Cancelado");
            int n=input.read(buf);
            if(n<0)break;
            if(n==0)continue;
            if(size>expected-n)throw new IOException("Arquivo excede tamanho esperado");
            output.write(buf,0,n);digest.update(buf,0,n);size+=n;progress.bytes(size);
        }
        if(cancel.cancelled())throw new InterruptedIOException("Cancelado");
        if(size!=expected||!hex(digest.digest()).equals(hash))throw new IOException("Integridade SHA-256 inválida");
    }
    static boolean trusted(URL url){
        String host=url.getHost().toLowerCase(java.util.Locale.ROOT);
        return "https".equals(url.getProtocol())&&url.getUserInfo()==null&&(url.getPort()==-1||url.getPort()==443)&&
            (host.equals("raw.githubusercontent.com")||host.equals("huggingface.co")||host.endsWith(".huggingface.co")||
             host.equals("hf.co")||host.endsWith(".hf.co")||host.equals("xethub.hf.co"));
    }
    private static void delete(File f)throws IOException{
        if(!f.exists())return;
        if(f.isDirectory()){File[] children=f.listFiles();if(children==null)throw new IOException("Diretório inacessível");for(File child:children)delete(child);}
        if(!f.delete()&&f.exists())throw new IOException("Não foi possível remover arquivos");
    }
    private void receive(Entry entry,File folder,long before)throws Exception{
        URL url=new URL(entry.url);
        for(int redirects=0;redirects<8;redirects++){
            if(cancel)throw new InterruptedIOException("Cancelado");
            if(!trusted(url))throw new IOException("Origem de download não autorizada");
            HttpURLConnection c=(HttpURLConnection)url.openConnection();
            active=c;
            try{
                c.setConnectTimeout(15000);c.setReadTimeout(30000);c.setInstanceFollowRedirects(false);
                c.setRequestProperty("Accept-Encoding","identity");
                int status=c.getResponseCode();
                if(status>=300&&status<400){
                    String next=c.getHeaderField("Location");if(next==null)throw new IOException("Redirecionamento inválido");
                    url=new URL(url,next);continue;
                }
                if(status!=200)throw new IOException("Download indisponível (HTTP "+status+")");
                long length=c.getContentLengthLong();
                if(length>=0&&length!=entry.bytes)throw new IOException("Tamanho recebido não confere");
                File target=new File(folder,entry.path);
                if(!target.getParentFile().isDirectory()&&!target.getParentFile().mkdirs())throw new IOException("Falha ao criar diretório");
                try(InputStream in=new BufferedInputStream(c.getInputStream(),65536);FileOutputStream out=new FileOutputStream(target)){
                    copyVerified(in,out,entry.bytes,entry.sha,()->cancel,n->downloaded=before+n);out.getFD().sync();
                }
                return;
            }finally{active=null;c.disconnect();}
        }
        throw new IOException("Excesso de redirecionamentos");
    }
    synchronized void start(){
        if("downloading".equals(phase)||"removing".equals(phase)||"installed".equals(phase))return;
        cancel=false;downloaded=0;phase="downloading";message="Verificando armazenamento…";
        new Thread(this::install,"harrier-install").start();
    }
    private void install(){
        File stage=new File(root,"partial-"+UUID.randomUUID());
        try{
            if(!root.isDirectory()&&!root.mkdirs())throw new IOException("Armazenamento privado indisponível");
            File[] orphans=root.listFiles();
            if(orphans!=null)for(File f:orphans)if(f.getName().startsWith("partial-"))delete(f);
            if(root.getUsableSpace()<REQUIRED_FREE)throw new IOException("Espaço insuficiente (reserve pelo menos 400 MB)");
            if(!stage.mkdirs())throw new IOException("Falha ao preparar pacote temporário");
            long done=0;
            for(Entry e:ENTRIES){
                if(cancel)throw new InterruptedIOException("Cancelado");
                message="Baixando e verificando: "+e.path;
                receive(e,stage,done);done+=e.bytes;
            }
            synchronized(this){
                if(cancel)throw new InterruptedIOException("Cancelado");
                if(done!=TOTAL_BYTES)throw new IOException("Pacote incompleto");
                try(FileOutputStream marker=new FileOutputStream(new File(stage,".verified"))){marker.write(1);marker.getFD().sync();}
                if(!hasFiles(stage))throw new IOException("Pacote inválido");
                if(installed.exists())delete(installed);
                if(!stage.renameTo(installed))throw new IOException("Não foi possível finalizar instalação");
                downloaded=TOTAL_BYTES;message="Arquivos instalados e verificados. Motor Android ainda não ativado.";phase="installed";
            }
        }catch(Exception e){
            try{delete(stage);}catch(IOException ignored){}
            downloaded=0;message=cancel?"Download cancelado.":"Falha: "+(e.getMessage()==null?"erro de instalação":e.getMessage());
            phase=cancel?"absent":"error";
        }
    }
    synchronized void cancel(){if(!"downloading".equals(phase))return;cancel=true;message="Cancelando…";HttpURLConnection c=active;if(c!=null)c.disconnect();}
    synchronized void remove(){
        if("downloading".equals(phase)||"removing".equals(phase))return;
        phase="removing";message="Removendo pacote…";
        new Thread(()->{
            try{delete(root);downloaded=0;message="Pacote removido.";phase="absent";}
            catch(IOException e){message="Falha ao remover pacote.";phase="error";}
        },"harrier-remove").start();
    }
    String phase(){return phase;}
    String message(){return message;}
    long downloaded(){return downloaded;}
}
