#include <jni.h>
#include <llama.h>
#include <ggml-backend.h>
#include <algorithm>
#include <atomic>
#include <cstdio>
#include <mutex>
#include <string>
#include <vector>
#include <stdexcept>
#include <thread>
#include <new>

static llama_model* g_model=nullptr;
static std::mutex g_mutex;
static std::mutex g_log_mutex;
static bool g_initialized=false;
static std::string g_recent_logs;
static std::atomic<int> g_load_progress{0};

static jstring asJava(JNIEnv* env,const std::string& value){return env->NewStringUTF(value.c_str());}
static void javaException(JNIEnv* env,const std::string& message){
    jclass cls=env->FindClass("java/lang/IllegalStateException");
    if(cls){env->ThrowNew(cls,message.c_str());env->DeleteLocalRef(cls);}
}
static void recordLog(ggml_log_level level,const char* message,void*){
    if(!message)return;
    std::string line(message);
    // Preserva as mensagens de diagnóstico do motor, incluindo arquiteturas GGUF não suportadas.
    if(level<GGML_LOG_LEVEL_WARN && line.find("failed")==std::string::npos && line.find("unknown")==std::string::npos && line.find("unsupported")==std::string::npos && line.find("error")==std::string::npos)return;
    std::lock_guard<std::mutex> lock(g_log_mutex);
    g_recent_logs+=line;
    if(g_recent_logs.length()>1700)g_recent_logs.erase(0,g_recent_logs.length()-1700);
}
static std::string logDetail(){
    std::lock_guard<std::mutex> lock(g_log_mutex);
    std::string r=g_recent_logs;
    std::replace(r.begin(),r.end(),'\n',' ');
    return r;
}
static bool modelProgress(float progress,void*){
    g_load_progress.store(std::clamp(static_cast<int>(progress*100.0f),0,100));
    return true;
}

extern "C" JNIEXPORT jint JNICALL
Java_br_com_buscadordehinos_app_MainActivity_nativeLoadProgress(JNIEnv*,jclass){
    return g_load_progress.load();
}

extern "C" JNIEXPORT jstring JNICALL
Java_br_com_buscadordehinos_app_MainActivity_nativeLoad(JNIEnv* env,jclass,jstring pathString){
    std::lock_guard<std::mutex> guard(g_mutex);
    if(!pathString){javaException(env,"Caminho do modelo ausente.");return nullptr;}
    const char* cpath=env->GetStringUTFChars(pathString,nullptr);
    if(!cpath){javaException(env,"Caminho do arquivo inválido.");return nullptr;}
    std::string path(cpath);env->ReleaseStringUTFChars(pathString,cpath);
    try {
        if(g_model){llama_model_free(g_model);g_model=nullptr;}
        if(!g_initialized){llama_log_set(recordLog,nullptr);llama_backend_init();g_initialized=true;}
        {std::lock_guard<std::mutex> lock(g_log_mutex);g_recent_logs.clear();}
        g_load_progress.store(0);
        llama_model_params params=llama_model_default_params();
        params.n_gpu_layers=0;
        params.use_mmap=true;     // Evita uma cópia inteira do modelo na RAM.
        params.use_mlock=false;   // Permite que o Android descarte páginas inativas.
        params.use_direct_io=false;
        params.use_extra_bufts=false; // Evita buffers de repacking adicionais no primeiro teste.
        params.progress_callback=modelProgress;
        g_model=llama_model_load_from_file(path.c_str(),params);
        if(!g_model){
            const std::string detail=logDetail();
            javaException(env,"Motor não conseguiu abrir o GGUF. Isso também pode ser formato incompatível ou falha de acesso ao arquivo, não apenas RAM. "+(detail.empty()?"Confira o modelo e a quantização.":"Detalhe do motor: "+detail));
            return nullptr;
        }
        g_load_progress.store(100);
        return asJava(env,"GGUF pronto. Peso mapeado sob demanda, sem cópia integral do arquivo.");
    }catch(const std::bad_alloc&){javaException(env,"Alocação nativa insuficiente. Feche aplicativos e use uma quantização menor; o contexto será reduzido nesta versão.");return nullptr;}
    catch(const std::exception& ex){javaException(env,std::string("Erro nativo ao abrir GGUF: ")+ex.what());return nullptr;}
}

extern "C" JNIEXPORT void JNICALL
Java_br_com_buscadordehinos_app_MainActivity_nativeUnload(JNIEnv*,jclass){
    std::lock_guard<std::mutex> guard(g_mutex);
    if(g_model){llama_model_free(g_model);g_model=nullptr;}
    g_load_progress.store(0);
}

extern "C" JNIEXPORT jstring JNICALL
Java_br_com_buscadordehinos_app_MainActivity_nativeGenerate(JNIEnv* env,jclass,jstring promptString,jint tokenLimit){
    std::lock_guard<std::mutex> guard(g_mutex);
    if(!g_model){javaException(env,"Nenhum GGUF carregado.");return nullptr;}
    if(!promptString){javaException(env,"Consulta vazia.");return nullptr;}
    const char* cprompt=env->GetStringUTFChars(promptString,nullptr);
    if(!cprompt){javaException(env,"Consulta não pôde ser interpretada.");return nullptr;}
    std::string prompt(cprompt);env->ReleaseStringUTFChars(promptString,cprompt);
    try {
        const char* tmpl=llama_model_chat_template(g_model,nullptr);
        llama_chat_message message={"user",prompt.c_str()};
        int formattedSize=llama_chat_apply_template(tmpl,&message,1,true,nullptr,0);
        if(formattedSize>0&&formattedSize<11000){
            std::vector<char> formatted(formattedSize+1,0);
            int used=llama_chat_apply_template(tmpl,&message,1,true,formatted.data(),formattedSize+1);
            if(used>0&&used<=(int)formattedSize)prompt.assign(formatted.data(),used);
        }
        const llama_vocab* vocab=llama_model_get_vocab(g_model);
        int n_tokens=llama_tokenize(vocab,prompt.c_str(),prompt.size(),nullptr,0,true,true);
        if(n_tokens<0)n_tokens=-n_tokens;
        if(n_tokens<=0||n_tokens>1000){javaException(env,"A consulta ultrapassou 1000 tokens para o contexto econômico. Reduza o texto.");return nullptr;}
        std::vector<llama_token> tokens(n_tokens);
        int count=llama_tokenize(vocab,prompt.c_str(),prompt.size(),tokens.data(),n_tokens,true,true);
        if(count<0){javaException(env,"Falha na tokenização do prompt.");return nullptr;}
        const int predict=std::clamp(static_cast<int>(tokenLimit),1,160);
        llama_context_params cp=llama_context_default_params();
        cp.n_ctx=1280;
        cp.n_batch=128;
        cp.n_ubatch=128;
        cp.n_seq_max=1;
        cp.n_threads=std::min(4,std::max(1,(int)std::thread::hardware_concurrency()));
        cp.n_threads_batch=cp.n_threads;
        llama_context* ctx=llama_init_from_model(g_model,cp);
        if(!ctx){javaException(env,"Não foi possível alocar contexto de 1280 tokens. A RAM efetivamente disponível para este processo pode ser menor que a exibida no sistema.");return nullptr;}
        llama_sampler* sampler=llama_sampler_init_greedy();
        if(!sampler){llama_free(ctx);javaException(env,"Não foi possível inicializar a amostragem.");return nullptr;}
        std::string out;
        bool failed=false;
        // O processamento em lotes menores reduz o pico de memória nativa no Android.
        for(int begin=0;begin<count;begin+=128){
            int length=std::min(128,count-begin);
            llama_batch batch=llama_batch_get_one(tokens.data()+begin,length);
            if(llama_decode(ctx,batch)!=0){failed=true;break;}
        }
        if(!failed){
            for(int i=0;i<predict;i++){
                llama_token next=llama_sampler_sample(sampler,ctx,-1);
                if(llama_vocab_is_eog(vocab,next))break;
                int size=llama_token_to_piece(vocab,next,nullptr,0,0,true);
                if(size<0)size=-size;
                if(size>0&&size<4096){
                    std::string piece(size,'\0');
                    int used=llama_token_to_piece(vocab,next,piece.data(),size,0,true);
                    if(used>0)out.append(piece.data(),used);
                }
                if(i+1<predict){
                    llama_batch nextBatch=llama_batch_get_one(&next,1);
                    if(llama_decode(ctx,nextBatch)!=0){failed=true;break;}
                }
            }
        }
        llama_sampler_free(sampler);llama_free(ctx);
        if(failed){javaException(env,"Falha de avaliação do modelo. O contexto ou os tensores podem não ser compatíveis com o motor atual.");return nullptr;}
        if(out.empty()){javaException(env,"Modelo não produziu resposta. Use um GGUF Instruct compatível.");return nullptr;}
        return asJava(env,out);
    }catch(const std::bad_alloc&){javaException(env,"Falta de memória durante geração. A busca local permanece disponível.");return nullptr;}
    catch(const std::exception& ex){javaException(env,std::string("Erro na geração: ")+ex.what());return nullptr;}
}
