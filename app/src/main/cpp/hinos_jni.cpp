#include <jni.h>
#include <llama.h>
#include <ggml-backend.h>
#include <algorithm>
#include <mutex>
#include <string>
#include <vector>
#include <stdexcept>
#include <thread>

static llama_model* g_model = nullptr;
static std::mutex g_mutex;
static bool g_initialized = false;

static jstring asJava(JNIEnv* env,const std::string& value){
    return env->NewStringUTF(value.c_str());
}
static void javaException(JNIEnv* env,const std::string& message){
    jclass cls=env->FindClass("java/lang/IllegalStateException");
    if(cls){env->ThrowNew(cls,message.c_str());env->DeleteLocalRef(cls);}
}

extern "C" JNIEXPORT jstring JNICALL
Java_br_com_buscadordehinos_app_MainActivity_nativeLoad(JNIEnv* env,jclass,jstring pathString){
    std::lock_guard<std::mutex> guard(g_mutex);
    if(!pathString){javaException(env,"Caminho do modelo ausente.");return nullptr;}
    const char* cpath=env->GetStringUTFChars(pathString,nullptr);
    std::string path(cpath);
    env->ReleaseStringUTFChars(pathString,cpath);
    if(g_model){llama_model_free(g_model);g_model=nullptr;}
    if(!g_initialized){llama_backend_init();g_initialized=true;}
    llama_model_params params=llama_model_default_params();
    params.n_gpu_layers=0; // Android arm64: CPU, sem exigir Vulkan/GPU.
    params.use_mmap=true;  // Mapeia o GGUF selecionado sem duplicá-lo.
    g_model=llama_model_load_from_file(path.c_str(),params);
    if(!g_model){javaException(env,"Não foi possível carregar o GGUF. Confirme compatibilidade, RAM e que o arquivo é local.");return nullptr;}
    return asJava(env,"Modelo GGUF carregado para inferência local.");
}

extern "C" JNIEXPORT void JNICALL
Java_br_com_buscadordehinos_app_MainActivity_nativeUnload(JNIEnv*,jclass){
    std::lock_guard<std::mutex> guard(g_mutex);
    if(g_model){llama_model_free(g_model);g_model=nullptr;}
}

extern "C" JNIEXPORT jstring JNICALL
Java_br_com_buscadordehinos_app_MainActivity_nativeGenerate(JNIEnv* env,jclass,jstring promptString,jint tokenLimit){
    std::lock_guard<std::mutex> guard(g_mutex);
    if(!g_model){javaException(env,"Nenhum GGUF carregado.");return nullptr;}
    if(!promptString){javaException(env,"Consulta vazia.");return nullptr;}
    const char* cprompt=env->GetStringUTFChars(promptString,nullptr);
    std::string prompt(cprompt);
    env->ReleaseStringUTFChars(promptString,cprompt);
    // Respeita o formato de chat embutido em modelos Instruct quando suportado.
    const char* tmpl=llama_model_chat_template(g_model,nullptr);
    llama_chat_message message={"user",prompt.c_str()};
    int formattedSize=llama_chat_apply_template(tmpl,&message,1,true,nullptr,0);
    if(formattedSize>0 && formattedSize<10000){
        std::vector<char> formatted(formattedSize+1,0);
        int used=llama_chat_apply_template(tmpl,&message,1,true,formatted.data(),formattedSize+1);
        if(used>0&&used<=(int)formattedSize)prompt.assign(formatted.data(),used);
    }
    const llama_vocab* vocab=llama_model_get_vocab(g_model);
    int n_tokens=llama_tokenize(vocab,prompt.c_str(),prompt.size(),nullptr,0,true,true);
    if(n_tokens<0)n_tokens=-n_tokens;
    if(n_tokens<=0||n_tokens>1300){javaException(env,"Prompt excedeu o limite local de 1300 tokens.");return nullptr;}
    std::vector<llama_token> tokens(n_tokens);
    int count=llama_tokenize(vocab,prompt.c_str(),prompt.size(),tokens.data(),n_tokens,true,true);
    if(count<0){javaException(env,"Falha na tokenização do prompt.");return nullptr;}
    const int predict=std::max(1,std::min((int)tokenLimit,128));
    const int context_size=2048;
    llama_context_params cp=llama_context_default_params();
    cp.n_ctx=context_size;
    cp.n_batch=std::max(512,count);
    cp.n_ubatch=256;
    cp.n_threads=std::min(4,std::max(1,(int)std::thread::hardware_concurrency()));
    cp.n_threads_batch=cp.n_threads;
    llama_context* ctx=llama_init_from_model(g_model,cp);
    if(!ctx){javaException(env,"Falha ao alocar contexto. O aparelho pode estar sem memória.");return nullptr;}
    llama_sampler* sampler=llama_sampler_init_greedy();
    if(!sampler){llama_free(ctx);javaException(env,"Falha ao inicializar amostrador.");return nullptr;}
    std::string out;
    llama_batch batch=llama_batch_get_one(tokens.data(),count);
    bool failed=false;
    llama_token next=LLAMA_TOKEN_NULL;
    for(int i=0;i<predict;i++){
        if(llama_decode(ctx,batch)!=0){failed=true;break;}
        next=llama_sampler_sample(sampler,ctx,-1);
        if(llama_vocab_is_eog(vocab,next))break;
        int size=llama_token_to_piece(vocab,next,nullptr,0,0,true);
        if(size<0)size=-size;
        if(size>0&&size<4096){
            std::string piece(size,'\0');
            int used=llama_token_to_piece(vocab,next,piece.data(),size,0,true);
            if(used>0)out.append(piece.data(),used);
        }
        // Sem interromper no primeiro \n: instrução pode retornar uma frase curta.
        batch=llama_batch_get_one(&next,1);
    }
    llama_sampler_free(sampler);
    llama_free(ctx);
    if(failed){javaException(env,"Falha durante a geração local.");return nullptr;}
    if(out.empty()){javaException(env,"Modelo não produziu texto. Tente outro GGUF do tipo Instruct.");return nullptr;}
    return asJava(env,out);
}
