package br.com.buscadordehinos.app;
import android.content.Context;
import ai.onnxruntime.OnnxTensor;
import ai.onnxruntime.OrtEnvironment;
import ai.onnxruntime.OrtSession;
import java.io.*;
import java.util.*;
final class E5Engine {
    interface Status {void send(String message);}
    private OrtEnvironment env;private OrtSession session;private E5Tokenizer tokenizer;
    private final Context app;
    E5Engine(Context ctx){app=ctx.getApplicationContext();}
    synchronized float[] embed(String query,Status status)throws Exception{
        if(query==null||query.trim().isEmpty())throw new IllegalArgumentException("Consulta vazia");
        prepare(status);
        int[] ids=tokenizer.encode("query: "+query,96);
        long[][] input=new long[1][ids.length],mask=new long[1][ids.length];
        for(int i=0;i<ids.length;i++){input[0][i]=ids[i];mask[0][i]=1;}
        Map<String,OnnxTensor> tensors=new HashMap<>();
        try{
            tensors.put("input_ids",OnnxTensor.createTensor(env,input));
            tensors.put("attention_mask",OnnxTensor.createTensor(env,mask));
            if(session.getInputNames().contains("token_type_ids"))
                tensors.put("token_type_ids",OnnxTensor.createTensor(env,new long[1][ids.length]));
            status.send("Calculando significado da consulta…");
            try(OrtSession.Result result=session.run(tensors)){
                Object output=((OnnxTensor)result.get(0)).getValue();
                if(!(output instanceof float[][][]))throw new IllegalStateException("Saída E5 não é float[1][tokens][384]");
                float[][][] rows=(float[][][])output;
                if(rows.length!=1||rows[0].length==0||rows[0][0].length!=384)throw new IllegalStateException("Dimensão E5 incorreta");
                float[] vector=new float[384];
                for(float[] token:rows[0])for(int i=0;i<384;i++)vector[i]+=token[i];
                double norm=0;
                for(int i=0;i<384;i++){vector[i]/=rows[0].length;norm+=vector[i]*vector[i];}
                norm=Math.sqrt(norm);
                if(!Double.isFinite(norm)||norm<1e-8)throw new IllegalStateException("Vetor E5 inválido");
                for(int i=0;i<384;i++)vector[i]/=(float)norm;
                return vector;
            }
        }finally{for(OnnxTensor t:tensors.values())t.close();}
    }
    private void prepare(Status status)throws Exception{
        if(session!=null)return;
        File dir=new File(app.getFilesDir(),"e5");
        if(!dir.exists()&&!dir.mkdirs())throw new IOException("Diretório do E5 não pôde ser criado");
        File model=new File(dir,"model-int8.onnx");
        if(!model.isFile()||model.length()<100_000_000){
            status.send("Preparando modelo vetorial E5 Small (primeiro uso)…");
            File tmp=new File(dir,"download.tmp");long done=0,last=0;
            try(InputStream in=new BufferedInputStream(app.getAssets().open("e5-model.onnx"),65536);
                OutputStream out=new BufferedOutputStream(new FileOutputStream(tmp),65536)){
                byte[] buffer=new byte[65536];int n;
                while((n=in.read(buffer))!=-1){
                    if(n==0)continue;out.write(buffer,0,n);done+=n;
                    if(done-last>12000000){last=done;status.send("Preparando E5: "+(done/1000000)+" MB");}
                }
            }catch(Exception ex){tmp.delete();throw ex;}
            if(!tmp.renameTo(model)){tmp.delete();throw new IOException("Não foi possível concluir cópia do modelo");}
        }
        status.send("Carregando modelo vetorial na memória…");
        env=OrtEnvironment.getEnvironment();
        OrtSession.SessionOptions options=new OrtSession.SessionOptions();
        try{
            options.setIntraOpNumThreads(1);
            options.addConfigEntry("session.use_deterministic_compute","1");
            options.addConfigEntry("session.x64quantprecision","1");
            options.setInterOpNumThreads(1);
            options.setOptimizationLevel(OrtSession.SessionOptions.OptLevel.ALL_OPT);
            session=env.createSession(model.getAbsolutePath(),options);
            tokenizer=new E5Tokenizer(app.getAssets());
        }finally{options.close();}
        status.send("E5 Small pronto. Modo offline.");
    }
}