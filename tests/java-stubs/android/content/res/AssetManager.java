package android.content.res;
public class AssetManager {
    private final java.nio.file.Path directory;
    public AssetManager(String path){directory=java.nio.file.Path.of(path);}
    public java.io.InputStream open(String name)throws java.io.IOException{
        if(!"e5-vocab.bin".equals(name))throw new java.io.IOException("Unsupported test asset");
        return java.nio.file.Files.newInputStream(directory.resolve(name));
    }
}
