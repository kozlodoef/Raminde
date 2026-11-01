package ru.voicereminder.app.reminders;

import android.content.Context;
import android.media.AudioFormat;
import android.media.AudioRecord;
import android.media.MediaRecorder;
import java.io.*;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import org.json.JSONObject;
import org.vosk.Model;
import org.vosk.Recognizer;

final class StreamingRecognizer {
 interface Listener { void started(); void partial(String text); void finished(String text); void failed(String code); }
 private final Context context; private final Listener listener; private final ExecutorService worker=Executors.newSingleThreadExecutor();
 private volatile boolean stopping; private AudioRecord recorder; private Model model; private String committed="";
 StreamingRecognizer(Context context,Listener listener){this.context=context.getApplicationContext();this.listener=listener;}
 void start(){worker.execute(()->{try{String path=prepareModel();model=new Model(path);int min=AudioRecord.getMinBufferSize(16000,AudioFormat.CHANNEL_IN_MONO,AudioFormat.ENCODING_PCM_16BIT);recorder=new AudioRecord(MediaRecorder.AudioSource.MIC,16000,AudioFormat.CHANNEL_IN_MONO,AudioFormat.ENCODING_PCM_16BIT,Math.max(min,8192));recorder.startRecording();listener.started();short[] buffer=new short[4096];try(Recognizer recognizer=new Recognizer(model,16000.0f)){while(!stopping){int n=recorder.read(buffer,0,buffer.length);if(n<=0)continue;if(recognizer.acceptWaveForm(buffer,n)){String segment=text(recognizer.getResult());if(!segment.isEmpty()){committed=(committed+" "+segment).trim();listener.partial(committed);}}else{String current=text(recognizer.getPartialResult());listener.partial((committed+" "+current).trim());}}String finalText=text(recognizer.getFinalResult());if(!finalText.isEmpty())committed=(committed+" "+finalText).trim();listener.finished(committed);}finally{releaseRecorder();}}catch(Exception e){if(!stopping)listener.failed(e.getMessage()==null?"speech-error":e.getMessage());}finally{if(model!=null){model.close();model=null;}worker.shutdown();}});}
 void stop(){stopping=true;releaseRecorder();}
 void abort(){stopping=true;releaseRecorder();}
 private void releaseRecorder(){AudioRecord r=recorder;if(r!=null){recorder=null;try{r.stop();}catch(Exception ignored){}try{r.release();}catch(Exception ignored){}}}
 private String text(String json){try{JSONObject value=new JSONObject(json);String text=value.optString("text","").trim();return text.isEmpty()?value.optString("partial","").trim():text;}catch(Exception e){return "";}}
 private String prepareModel()throws IOException{File out=new File(context.getFilesDir(),"vosk-model");if(new File(out,"am/final.mdl").exists())return out.getAbsolutePath();copy(context.getAssets(),"model",out);return out.getAbsolutePath();}
 private void copy(android.content.res.AssetManager assets,String source,File out)throws IOException{String[] children=assets.list(source);if(children==null||children.length==0){out.getParentFile().mkdirs();try(InputStream in=assets.open(source);OutputStream os=new FileOutputStream(out)){byte[] b=new byte[8192];int n;while((n=in.read(b))>=0)os.write(b,0,n);}return;}out.mkdirs();for(String child:children)copy(assets,source+"/"+child,new File(out,child));}
}
