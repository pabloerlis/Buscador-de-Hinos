package br.com.buscadordehinos.app;

import android.content.Context;
import android.net.Uri;
import ai.onnxruntime.OnnxTensor;
import ai.onnxruntime.OnnxValue;
import ai.onnxruntime.OrtEnvironment;
import ai.onnxruntime.OrtException;
import ai.onnxruntime.OrtSession;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.IOException;
import java.security.MessageDigest;
import java.util.Arrays;
import java.util.HashMap;
import java.util.Map;
import java.util.Set;
import java.util.HashSet;
import java.util.Locale;
import java.util.zip.ZipEntry;
import java.util.zip.ZipInputStream;
import org.json.JSONArray;
import org.json.JSONObject;

/** Executes the EXACT external Telepatia Laya PT/ES NLI ONNX graph.
 *
 * Model weights are NOT bundled with the APK and are never downloaded silently.
 * Installation accepts a user-chosen ZIP, performs bounded streaming extraction
 * and SHA-256 verification against an export manifest of the pinned revision.
 * The UI supplies already tokenized Laya-format int64 input arrays; Java refuses
 * requests when model, marker mask or tensor contract does not match.
 */
final class TelepatiaNliEngine implements AutoCloseable {
    static final String MODEL = "telepatia-ai/laya-pt-es-nli";
    static final String REV = "71459abd38f4e439b2f4e3a2dae87573ae40c77e";
    private static final String ROOT = "telepatia-nli";
    private static final long MAX_TOTAL = 2_500_000_000L;
    private static final int MAX_INPUT = 8192;
    private final Context app;
    private OrtEnvironment env;
    private OrtSession session;
    private File activeDir;
    private String installedSha = "";
    private static final Map<String,Long> MAX_FILES = new HashMap<>();
    static {
        MAX_FILES.put("model.onnx", 80_000_000L);
        MAX_FILES.put("model.onnx.data", 2_200_000_000L);
        MAX_FILES.put("tokenizer/tokenizer.json", 90_000_000L);
        MAX_FILES.put("tokenizer/tokenizer_config.json", 2_000_000L);
        MAX_FILES.put("rl_agent_config.json", 1_000_000L);
        MAX_FILES.put("manifest.json", 2_000_000L);
    }

    TelepatiaNliEngine(Context context){app=context.getApplicationContext();}
    boolean isLoaded(){return session!=null;}
    boolean isInstalled(){return new File(app.getFilesDir(),ROOT+"/manifest.json").isFile();}
    String modelSha(){return installedSha;}
    File modelDir(){return new File(app.getFilesDir(),ROOT);}
    File tokenizerFile(String name) {
        if(!"tokenizer.json".equals(name)&&!"tokenizer_config.json".equals(name))return null;
        File file=new File(modelDir(),"tokenizer/"+name);
        return file.isFile()?file:null;
    }
    private static String hex(byte[] bytes){
        StringBuilder s=new StringBuilder(bytes.length*2);
        for(byte b:bytes)s.append(String.format(Locale.ROOT,"%02x",b&255));
        return s.toString();
    }
    private static String digest(File file)throws Exception{
        MessageDigest sha=MessageDigest.getInstance("SHA-256");
        try(InputStream in=new FileInputStream(file)){
            byte[] buf=new byte[1<<20];int n;
            while((n=in.read(buf))!=-1)sha.update(buf,0,n);
        }
        return hex(sha.digest());
    }
    private static void require(boolean condition,String message)throws IOException{
        if(!condition)throw new IOException(message);
    }
    private static void delete(File file)throws IOException{
        if(!file.exists())return;
        if(file.isDirectory()){
            File[] children=file.listFiles();
            if(children==null)throw new IOException("Falha ao listar diretório.");
            for(File child:children)delete(child);
        }
        if(!file.delete())throw new IOException("Falha ao limpar pasta privada.");
    }
    private static String acceptedName(String original)throws IOException{
        require(original!=null && !original.startsWith("/") && original.indexOf('\\')<0 &&
            !original.contains("..") && original.indexOf('\0')<0,"Caminho ZIP inválido.");
        String prefix="telepatia-pt-es-nli/";
        int i=original.indexOf(prefix);
        String name=i>=0?original.substring(i+prefix.length()):original;
        if(name.endsWith("/")||!MAX_FILES.containsKey(name))return null;
        return name;
    }
    private static byte[] readSmall(File file,long max)throws Exception{
        require(file.isFile()&&file.length()>0&&file.length()<=max,"Metadados NLI inválidos: "+file.getName());
        try(InputStream input=new FileInputStream(file);java.io.ByteArrayOutputStream out=new java.io.ByteArrayOutputStream()){
            byte[] buf=new byte[8192];int n;
            while((n=input.read(buf))!=-1){
                require(out.size()+n<=max,"Metadados NLI excedem tamanho máximo.");
                out.write(buf,0,n);
            }
            return out.toByteArray();
        }
    }
    private static void verify(File dir)throws Exception{
        for(String name:MAX_FILES.keySet()){
            File file=new File(dir,name);
            require(file.isFile()&&file.length()>0,"Modelo externo incompleto: "+name);
        }
        JSONObject manifest=new JSONObject(new String(
            readSmall(new File(dir,"manifest.json"),2_000_000L),
            java.nio.charset.StandardCharsets.UTF_8));
        require(MODEL.equals(manifest.optString("model"))&&REV.equals(manifest.optString("revision")),
            "O pacote não corresponde ao checkpoint Telepatia aprovado.");
        require("verified".equals(manifest.optString("status")),
            "O pacote não passou pela auditoria de exportação.");
        require(digest(new File(dir,"model.onnx")).equalsIgnoreCase(manifest.optString("onnx_sha256")),
            "SHA-256 do grafo ONNX inválido.");
        require(digest(new File(dir,"model.onnx.data")).equalsIgnoreCase(manifest.optString("sidecar_sha256")),
            "SHA-256 dos pesos ONNX inválido.");
        require(digest(new File(dir,"tokenizer/tokenizer.json")).equalsIgnoreCase(manifest.optString("tokenizer_sha256")),
            "SHA-256 do tokenizador inválido.");
        JSONObject cfg=new JSONObject(new String(
            readSmall(new File(dir,"rl_agent_config.json"),1_000_000L),
            java.nio.charset.StandardCharsets.UTF_8));
        require(cfg.optInt("max_len",512)>=128,"Configuração Laya incompatível.");
    }

    /** WARNING: large ZIP; must run on a dedicated background executor. */
    synchronized void install(InputStream stream)throws Exception{
        File stage=new File(app.getFilesDir(),"telepatia-nli-staging");
        delete(stage);
        require(stage.mkdirs(),"Sem espaço ou permissão para criar pasta privada.");
        boolean done=false;
        try(ZipInputStream zip=new ZipInputStream(stream)){
            Set<String> written=new HashSet<>();
            byte[] buf=new byte[65536];
            long accumulated=0;
            ZipEntry entry;
            while((entry=zip.getNextEntry())!=null){
                String name=acceptedName(entry.getName());
                if(entry.isDirectory()||name==null){zip.closeEntry();continue;}
                require(written.add(name),"Arquivo ZIP duplicado: "+name);
                File dest=new File(stage,name);
                File parent=dest.getParentFile();
                require(parent.isDirectory()||parent.mkdirs(),"Sem permissão para extrair tokenizador.");
                long perFile=0;
                try(FileOutputStream out=new FileOutputStream(dest)){
                    int n;
                    while((n=zip.read(buf))!=-1){
                        perFile+=n;accumulated+=n;
                        require(perFile<=MAX_FILES.get(name) && accumulated<=MAX_TOTAL,
                            "Pacote NLI excede os limites de tamanho.");
                        out.write(buf,0,n);
                    }
                    out.getFD().sync();
                }
                zip.closeEntry();
            }
            verify(stage);
            close();
            File current=modelDir();
            delete(current);
            require(stage.renameTo(current),"Falha ao instalar checkpoint no armazenamento local.");
            done=true;
        }finally{
            if(!done)delete(stage);
        }
    }

    synchronized void load()throws Exception{
        if(session!=null)return;
        File dir=modelDir();
        verify(dir);  // never load an unchecked external file
        env=OrtEnvironment.getEnvironment();
        OrtSession.SessionOptions opts=new OrtSession.SessionOptions();
        opts.setIntraOpNumThreads(2);
        opts.setInterOpNumThreads(1);
        try{
            session=env.createSession(new File(dir,"model.onnx").getAbsolutePath(),opts);
            Set<String> inputs=session.getInputNames();
            require(inputs.size()==5 && inputs.containsAll(Arrays.asList("input_ids","attention_mask",
                "marker_pos","marker_mask","qtype")),"Contrato ONNX de Laya incompatível.");
            installedSha=digest(new File(dir,"model.onnx"));
            activeDir=dir;
        }catch(Exception e){
            if(session!=null){session.close();session=null;}
            throw e;
        }finally{opts.close();}
    }

    synchronized JSONObject classify(JSONObject request)throws Exception{
        require(session!=null,"Telepatia ainda não está carregado.");
        JSONArray arr=request.optJSONArray("input_ids");
        JSONArray marks=request.optJSONArray("marker_pos");
        require(arr!=null && marks!=null && arr.length()>=16 && arr.length()<=MAX_INPUT
            && marks.length()==3,"Entrada NLI ausente ou fora dos limites.");
        long[][] ids=new long[1][arr.length()];
        long[][] masks=new long[1][arr.length()];
        for(int i=0;i<arr.length();i++){
            ids[0][i]=arr.getLong(i);
            masks[0][i]=1L;
            require(ids[0][i]>=0&&ids[0][i]<1_000_000,"Token ID inválido.");
        }
        long[][] positions=new long[1][3];
        boolean[][] markerMask={{true,true,true}};
        for(int i=0;i<3;i++){
            positions[0][i]=marks.getLong(i);
            require(positions[0][i]>=0&&positions[0][i]<arr.length(),
                "Marcador NLI inválido.");
            if(i>0)require(positions[0][i]>positions[0][i-1],"Marcadores fora de ordem.");
        }
        try(OnnxTensor tIds=OnnxTensor.createTensor(env,ids);
            OnnxTensor tMask=OnnxTensor.createTensor(env,masks);
            OnnxTensor tPos=OnnxTensor.createTensor(env,positions);
            OnnxTensor tMarked=OnnxTensor.createTensor(env,markerMask);
            OnnxTensor tType=OnnxTensor.createTensor(env,new long[]{0})){
            Map<String,OnnxTensor> inputs=new HashMap<>();
            inputs.put("input_ids",tIds);inputs.put("attention_mask",tMask);
            inputs.put("marker_pos",tPos);inputs.put("marker_mask",tMarked);
            inputs.put("qtype",tType);
            long started=System.nanoTime();
            try(OrtSession.Result result=session.run(inputs)){
                OnnxValue value=result.get("logits").orElseThrow(
                    ()->new IOException("Saída ONNX logits ausente."));
                Object out=value.getValue();
                if(!(out instanceof float[][]))throw new IOException("Saída de classificação ONNX incompatível.");
                float[][] logits=(float[][])out;
                require(logits.length==1&&logits[0].length==3,"A classificação não tem três alternativas.");
                String[] labels={"contradiction","entailment","neutral"};
                int winner=0;
                JSONArray raw=new JSONArray();
                for(int i=0;i<3;i++){
                    require(Float.isFinite(logits[0][i]),"Logit NaN ou infinito.");
                    raw.put(logits[0][i]);
                    if(logits[0][i]>logits[0][winner])winner=i;
                }
                return new JSONObject().put("label",labels[winner]).put("logits",raw)
                    .put("ms",(System.nanoTime()-started)/1_000_000L);
            }
        }
    }

    @Override public synchronized void close()throws Exception{
        if(session!=null){session.close();session=null;}
        installedSha="";
        activeDir=null;
    }
}
