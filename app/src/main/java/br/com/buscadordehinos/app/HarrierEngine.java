package br.com.buscadordehinos.app;

import ai.onnxruntime.*;
import org.json.*;
import java.io.*;
import java.nio.FloatBuffer;
import java.util.*;

/** Runs the embedding graph only. No model or token vocabulary bundled in the APK. */
final class HarrierEngine implements AutoCloseable {
    static final int DIM=1024,MAX_TOKENS=192;
    private final OrtEnvironment environment;
    private final OrtSession session;
    HarrierEngine(File directory)throws Exception{
        environment=OrtEnvironment.getEnvironment();
        try(OrtSession.SessionOptions options=new OrtSession.SessionOptions()){
            options.setIntraOpNumThreads(Math.max(1,Math.min(3,Runtime.getRuntime().availableProcessors()-1)));
            options.setInterOpNumThreads(1);
            options.setOptimizationLevel(OrtSession.SessionOptions.OptLevel.ALL_OPT);
            session=environment.createSession(new File(directory,"onnx/model_q4f16.onnx").getAbsolutePath(),options);
        }
        if(!session.getInputNames().equals(new HashSet<>(Arrays.asList("input_ids","attention_mask")))||
           !session.getOutputNames().contains("sentence_embedding")){
            session.close();throw new IOException("Assinatura ONNX inesperada");
        }
    }
    synchronized float[] embed(long[] ids)throws Exception{
        if(ids.length<1||ids.length>MAX_TOKENS)throw new IllegalArgumentException("Quantidade de tokens inválida");
        for(long id:ids)if(id<0||id>200000)throw new IllegalArgumentException("Token inválido");
        long[][] input={ids},mask=new long[1][ids.length];Arrays.fill(mask[0],1);
        try(OnnxTensor tokens=OnnxTensor.createTensor(environment,input);
            OnnxTensor attention=OnnxTensor.createTensor(environment,mask)){
            Map<String,OnnxTensor> inputs=new HashMap<>();inputs.put("input_ids",tokens);inputs.put("attention_mask",attention);
            try(OrtSession.Result result=session.run(inputs)){
                OnnxValue value=result.get("sentence_embedding").orElseThrow(()->new IllegalStateException("Saída sem embedding"));
                if(!(value instanceof OnnxTensor))throw new IOException("Saída inválida");
                FloatBuffer buffer=((OnnxTensor)value).getFloatBuffer();
                if(buffer==null||buffer.remaining()!=DIM)throw new IOException("Dimensão da saída não é 1024");
                float[] vector=new float[DIM];buffer.get(vector);
                double sq=0;for(float v:vector){if(!Float.isFinite(v))throw new IOException("Vetor não finito");sq+=(double)v*v;}
                if(!Double.isFinite(sq)||sq<1e-12)throw new IOException("Vetor nulo");
                double norm=Math.sqrt(sq);for(int i=0;i<DIM;i++)vector[i]/=(float)norm;
                return vector;
            }
        }
    }
    static JSONObject verify(File directory,JSONObject reference,JSONArray supplied)throws Exception{
        if(!"dbaf6767003608562dd5b744bc443656a29c45bd".equals(reference.getString("revision"))||
           !"q4f16".equals(reference.getString("variant"))||
           !"1.31.1".equals(reference.getString("runtime")))throw new IOException("Referência incompatível");
        JSONArray cases=reference.getJSONArray("fixtures");
        if(cases.length()!=3||supplied.length()!=3)throw new IOException("Casos de referência inválidos");
        long start=System.nanoTime();double min=1;
        JSONArray measurements=new JSONArray();
        try(HarrierEngine engine=new HarrierEngine(directory)){
            long load=(System.nanoTime()-start)/1000000;
            for(int k=0;k<cases.length();k++){
                JSONObject fixture=cases.getJSONObject(k);
                JSONArray expected=fixture.getJSONArray("ids"),actual=supplied.getJSONArray(k),target=fixture.getJSONArray("embedding");
                if(actual.length()!=expected.length()||actual.length()<1||actual.length()>MAX_TOKENS||target.length()!=DIM)throw new IOException("Formato de referência inválido");
                long[] ids=new long[actual.length()];
                for(int i=0;i<ids.length;i++){
                    Object item=actual.get(i);
                    if(!(item instanceof Number)||((Number)item).doubleValue()!=expected.getLong(i))throw new IOException("Tokenização não confere");
                    ids[i]=expected.getLong(i);
                }
                long before=System.nanoTime();float[] vector=engine.embed(ids);
                double dot=0,refSq=0;
                for(int i=0;i<DIM;i++){
                    double v=target.getDouble(i);
                    if(!Double.isFinite(v))throw new IOException("Referência não finita");
                    dot+=vector[i]*v;refSq+=v*v;
                }
                double cosine=dot/Math.sqrt(refSq);
                if(!Double.isFinite(cosine)||cosine<0.995)throw new IOException("Vetor divergente no caso "+(k+1)+": "+cosine);
                min=Math.min(min,cosine);
                measurements.put(new JSONObject().put("case",k+1).put("tokens",ids.length)
                    .put("cosine",cosine).put("ms",(System.nanoTime()-before)/1000000));
            }
            return new JSONObject().put("passed",true).put("load_ms",load).put("min_cosine",min).put("cases",measurements);
        }
    }
    @Override public void close()throws OrtException{session.close();}
}
