#include <jni.h>
#include <llama.h>
#include <ggml-backend.h>
#include <algorithm>
#include <atomic>
#include <chrono>
#include <cstdio>
#include <memory>
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
static std::atomic<int> g_generation_stage{0};
static std::atomic<bool> g_cancel{false};

using Clock = std::chrono::steady_clock;

struct GenerationDeadline { Clock::time_point expires; };

static bool shouldCancel(void* data) {
    const auto* deadline = static_cast<const GenerationDeadline*>(data);
    return g_cancel.load(std::memory_order_relaxed) || Clock::now() >= deadline->expires;
}

static jlong elapsedMs(Clock::time_point from) {
    return std::chrono::duration_cast<std::chrono::milliseconds>(Clock::now() - from).count();
}

static std::string readUtf8(JNIEnv* env, jbyteArray bytes) {
    if (!bytes) return {};
    const jsize length = env->GetArrayLength(bytes);
    std::string value(length, '\0');
    if (length > 0) env->GetByteArrayRegion(bytes, 0, length, reinterpret_cast<jbyte*>(value.data()));
    return value;
}

static jbyteArray writeUtf8(JNIEnv* env, const std::string& value) {
    const auto length = static_cast<jsize>(value.size());
    jbyteArray bytes = env->NewByteArray(length);
    if (bytes) env->SetByteArrayRegion(bytes, 0, length, reinterpret_cast<const jbyte*>(value.data()));
    return bytes;
}

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

extern "C" JNIEXPORT void JNICALL
Java_br_com_buscadordehinos_app_MainActivity_nativeCancel(JNIEnv*,jclass){
    g_cancel.store(true,std::memory_order_relaxed);
}

extern "C" JNIEXPORT void JNICALL
Java_br_com_buscadordehinos_app_MainActivity_nativeResetCancellation(JNIEnv*,jclass){
    g_cancel.store(false,std::memory_order_relaxed);
    g_generation_stage.store(0,std::memory_order_relaxed);
}

extern "C" JNIEXPORT jint JNICALL
Java_br_com_buscadordehinos_app_MainActivity_nativeGenerationStage(JNIEnv*,jclass){
    return g_generation_stage.load(std::memory_order_relaxed);
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
        params.load_mode=LLAMA_LOAD_MODE_MMAP;
        params.load_mtp=false;
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

extern "C" JNIEXPORT jbyteArray JNICALL
Java_br_com_buscadordehinos_app_MainActivity_nativeGenerate(JNIEnv* env,jclass,jbyteArray promptBytes,
        jbyteArray grammarBytes,jint tokenLimit,jint timeoutMs,jlongArray metrics){
    std::lock_guard<std::mutex> guard(g_mutex);
    if(!g_model){javaException(env,"Nenhum GGUF carregado.");return nullptr;}
    try {
        const auto started = Clock::now();
        GenerationDeadline deadline{started + std::chrono::milliseconds(timeoutMs)};
        std::string prompt = readUtf8(env, promptBytes);
        const std::string grammar = readUtf8(env, grammarBytes);
        if (env->ExceptionCheck()) return nullptr;
        if (prompt.empty()) { javaException(env,"Consulta vazia."); return nullptr; }
        if (shouldCancel(&deadline)) { javaException(env,"Geração cancelada."); return nullptr; }
        g_generation_stage.store(1,std::memory_order_relaxed);
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
        const int predict=std::clamp(static_cast<int>(tokenLimit),1,120);
        llama_context_params cp=llama_context_default_params();
        cp.n_ctx=1280;
        cp.n_batch=96;
        cp.n_ubatch=96;
        cp.n_seq_max=1;
        cp.abort_callback=shouldCancel;
        cp.abort_callback_data=&deadline;
        cp.n_threads=std::min(4,std::max(1,(int)std::thread::hardware_concurrency()));
        cp.n_threads_batch=cp.n_threads;
        std::unique_ptr<llama_context, decltype(&llama_free)> ctx(llama_init_from_model(g_model,cp), llama_free);
        if(!ctx){javaException(env,"Não foi possível alocar contexto de 1280 tokens. A RAM efetivamente disponível para este processo pode ser menor que a exibida no sistema.");return nullptr;}
        std::unique_ptr<llama_sampler, decltype(&llama_sampler_free)> sampler(
            llama_sampler_chain_init(llama_sampler_chain_default_params()), llama_sampler_free);
        if(!sampler){javaException(env,"Não foi possível inicializar a amostragem.");return nullptr;}
        if (!grammar.empty()) {
            llama_sampler* constraint = llama_sampler_init_grammar(vocab, grammar.c_str(), "root");
            if (!constraint) { javaException(env,"Formato de geração inválido."); return nullptr; }
            llama_sampler_chain_add(sampler.get(), constraint);
        }
        llama_sampler* greedy = llama_sampler_init_greedy();
        if (!greedy) { javaException(env,"Não foi possível inicializar a amostragem."); return nullptr; }
        llama_sampler_chain_add(sampler.get(), greedy);

        const jlong setupMs = elapsedMs(started);
        g_generation_stage.store(2,std::memory_order_relaxed);
        const auto prefillStarted = Clock::now();
        std::string out;
        bool failed=false;
        // O processamento em lotes menores reduz o pico de memória nativa no Android.
        for(int begin=0;begin<count;begin+=96){
            if(shouldCancel(&deadline)) {failed=true;break;}
            int length=std::min(96,count-begin);
            llama_batch batch=llama_batch_get_one(tokens.data()+begin,length);
            if(llama_decode(ctx.get(),batch)!=0){failed=true;break;}
        }
        const jlong prefillMs = elapsedMs(prefillStarted);
        jlong firstTokenMs = -1;
        jlong generated = 0;
        if(!failed){
            g_generation_stage.store(3,std::memory_order_relaxed);
            for(int i=0;i<predict;i++){
                if(shouldCancel(&deadline)){failed=true;break;}
                llama_token next=llama_sampler_sample(sampler.get(),ctx.get(),-1);
                if(llama_vocab_is_eog(vocab,next))break;
                if (generated++ == 0) firstTokenMs = elapsedMs(started);
                int size=llama_token_to_piece(vocab,next,nullptr,0,0,true);
                if(size<0)size=-size;
                if(size>0&&size<4096){
                    std::string piece(size,'\0');
                    int used=llama_token_to_piece(vocab,next,piece.data(),size,0,true);
                    if(used>0)out.append(piece.data(),used);
                }
                if(i+1<predict){
                    llama_batch nextBatch=llama_batch_get_one(&next,1);
                    if(llama_decode(ctx.get(),nextBatch)!=0){failed=true;break;}
                }
            }
        }
        if(g_cancel.load(std::memory_order_relaxed)){javaException(env,"Geração cancelada.");return nullptr;}
        if(Clock::now()>=deadline.expires){javaException(env,"Tempo limite de geração atingido.");return nullptr;}
        if(failed){javaException(env,"Falha de avaliação do modelo. O contexto ou os tensores podem não ser compatíveis com o motor atual.");return nullptr;}
        if(out.empty()){javaException(env,"Modelo não produziu resposta. Use um GGUF Instruct compatível.");return nullptr;}
        const jlong resultMetrics[] = {setupMs, prefillMs, firstTokenMs, generated};
        env->SetLongArrayRegion(metrics, 0, 4, resultMetrics);
        if (env->ExceptionCheck()) return nullptr;
        return writeUtf8(env,out);
    }catch(const std::bad_alloc&){javaException(env,"Falta de memória durante geração. A busca local permanece disponível.");return nullptr;}
    catch(const std::exception& ex){javaException(env,std::string("Erro na geração: ")+ex.what());return nullptr;}
}
