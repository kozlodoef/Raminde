package ru.voicereminder.app.reminders;
import android.Manifest;import android.app.*;import android.content.*;import android.net.Uri;import android.os.*;import android.provider.Settings;import android.speech.*;import android.speech.tts.TextToSpeech;import androidx.core.app.NotificationManagerCompat;import com.getcapacitor.*;import com.getcapacitor.annotation.*;import org.json.*;import java.util.*;
@CapacitorPlugin(name="ReminderEngine",permissions={@Permission(alias="microphone",strings={Manifest.permission.RECORD_AUDIO}),@Permission(alias="notifications",strings={Manifest.permission.POST_NOTIFICATIONS})})
public class ReminderPlugin extends Plugin {
 private SpeechRecognizer recognizer;private PluginCall recognition;private TextToSpeech preview;

 @PluginMethod public void migrate(PluginCall call){try(ReminderStore db=new ReminderStore(getContext())){if(db.meta("migration").optBoolean("done")){getState(call);return;}JSONArray list=call.getArray("reminders",new JSArray());db.getWritableDatabase().beginTransaction();try{for(int i=0;i<list.length();i++){JSONObject r=list.getJSONObject(i);if(db.rule(r.getString("id"))!=null)continue;long next=ScheduleEngine.next(r.getJSONObject("schedule"),System.currentTimeMillis());r.put("nextTriggerAt",next>0?next:JSONObject.NULL);if(next<=0)r.put("enabled",false);db.put("rules","rid",r.getString("id"),r);}JSObject settings=call.getObject("settings");if(settings!=null&&db.meta("settings").length()==0)db.meta("settings",settings);db.meta("migration",new JSONObject().put("done",true));db.getWritableDatabase().setTransactionSuccessful();}finally{db.getWritableDatabase().endTransaction();}AlarmScheduler.restore(getContext());call.resolve(JSObject.fromJSONObject(db.state()));}catch(Exception e){call.reject(e.getMessage());}}
 @Override protected void handleOnResume(){AlarmScheduler.restore(getContext());}
 @PluginMethod public void getBillingCredential(PluginCall call){try{call.resolve(new JSObject().put("token",SecretVault.get(getContext())));}catch(Exception e){call.reject("Не удалось прочитать ключ восстановления");}}
 @PluginMethod public void setBillingCredential(PluginCall call){try{SecretVault.set(getContext(),call.getString("token",""));call.resolve();}catch(Exception e){call.reject("Не удалось сохранить ключ восстановления");}}
 @PluginMethod public void getState(PluginCall call){try(ReminderStore db=new ReminderStore(getContext())){call.resolve(JSObject.fromJSONObject(db.state()));}catch(Exception e){call.reject(e.getMessage());}}
 @PluginMethod public void settings(PluginCall call){try(ReminderStore db=new ReminderStore(getContext())){JSObject s=call.getObject("settings");if(s==null){call.reject("Нет настроек");return;}db.meta("settings",s);call.resolve(JSObject.fromJSONObject(db.state()));}catch(Exception e){call.reject(e.getMessage());}}
 @PluginMethod public void upsert(PluginCall call){try(ReminderStore db=new ReminderStore(getContext())){JSObject r=call.getObject("reminder");if(r==null||r.optString("id").isEmpty()||r.optString("text").trim().isEmpty())throw new IllegalArgumentException("Добавьте текст напоминания");String id=r.getString("id");JSONObject previous=db.rule(id);long next=ScheduleEngine.next(r.getJSONObject("schedule"),System.currentTimeMillis());if(r.optBoolean("enabled",true)&&next<=0)throw new IllegalArgumentException("Нет будущих дат");if(r.optBoolean("enabled",true)&&!AlarmScheduler.exact(getContext()))throw new IllegalArgumentException("Разрешите точные будильники");if(r.optBoolean("enabled",true)&&!NotificationManagerCompat.from(getContext()).areNotificationsEnabled())throw new IllegalArgumentException("Разрешите уведомления в Android");JSONObject q=db.quota();boolean fresh=previous==null;JSONObject access=db.access();if((fresh||r.optBoolean("enabled",true))&&access.optLong("trialEndsAt",0)<=System.currentTimeMillis()&&call.getString("reservation")==null){call.reject("SUBSCRIPTION");return;}
 db.getWritableDatabase().beginTransaction();try{AlarmScheduler.plan(getContext(),db,r);if(fresh){q.put("used",q.optInt("used")+1);db.meta("quota",q);}db.getWritableDatabase().setTransactionSuccessful();}finally{db.getWritableDatabase().endTransaction();}call.resolve(JSObject.fromJSONObject(db.state()));}catch(Exception e){call.reject(e.getMessage());}}
 @PluginMethod public void skip(PluginCall call){try(ReminderStore db=new ReminderStore(getContext())){String id=call.getString("id");Long at=call.getLong("at");JSONObject r=db.rule(id);if(r==null)throw new IllegalArgumentException("Напоминание не найдено");if(at==null||at<=System.currentTimeMillis())throw new IllegalArgumentException("Срабатывание уже началось: подтвердите или отложите его");JSONObject schedule=r.getJSONObject("schedule");JSONArray xs=schedule.optJSONArray("excludedInstants");if(xs==null)xs=new JSONArray();xs.put(at);schedule.put("excludedInstants",xs);AlarmScheduler.plan(getContext(),db,r);call.resolve(JSObject.fromJSONObject(db.state()));}catch(Exception ex){call.reject(ex.getMessage());}}
 @PluginMethod public void remove(PluginCall call){try(ReminderStore db=new ReminderStore(getContext())){String id=call.getString("id");AlarmScheduler.cancel(getContext(),AlarmScheduler.FIRE,id);JSONArray events=db.all("events");for(int i=0;i<events.length();i++){JSONObject e=events.optJSONObject(i);if(e.optString("reminderId").equals(id))AlarmReceiver.ack(getContext(),db,e.getString("id"),"deleted");}db.removeRule(id);call.resolve(JSObject.fromJSONObject(db.state()));}catch(Exception e){call.reject(e.getMessage());}}
 @PluginMethod public void acknowledge(PluginCall call){try(ReminderStore db=new ReminderStore(getContext())){AlarmReceiver.ack(getContext(),db,call.getString("id"),call.getString("source","button"));call.resolve(JSObject.fromJSONObject(db.state()));}catch(Exception e){call.reject(e.getMessage());}}
 @PluginMethod public void snooze(PluginCall call){try(ReminderStore db=new ReminderStore(getContext())){AlarmReceiver.snooze(getContext(),db,call.getString("id"),call.getInt("minutes",5));call.resolve(JSObject.fromJSONObject(db.state()));}catch(Exception e){call.reject(e.getMessage());}}
 @PluginMethod public void permissions(PluginCall call){JSObject r=new JSObject();r.put("notifications",NotificationManagerCompat.from(getContext()).areNotificationsEnabled()?"granted":"denied");r.put("exact",AlarmScheduler.exact(getContext()));
  // Android 14+ (API 34) разрешает полноэкранные уведомления только с явного
  // согласия пользователя. Без этого напоминание не развернётся на
  // заблокированном экране и его легко пропустить.
  r.put("fullscreen",fullscreenAllowed());r.put("battery",batteryOk());
  r.put("platform","android");call.resolve(r);}

 /** Доступны ли полноэкранные уведомления (напоминание поверх блокировки). */
 private boolean fullscreenAllowed(){
  if(Build.VERSION.SDK_INT<34)return true; // до Android 14 разрешено по умолчанию
  try{return getContext().getSystemService(android.app.NotificationManager.class).canUseFullScreenIntent();}
  catch(Exception e){return false;}
 }
 @PluginMethod public void requestPermissions(PluginCall call){if(Build.VERSION.SDK_INT>=33&&getPermissionState("notifications")!=PermissionState.GRANTED){requestPermissionForAlias("notifications",call,"notificationResult");return;}openExact(call);}

 /**
  * Открывает системный экран разрешения полноэкранных уведомлений.
  *
  * Отдельный метод, а не часть requestPermissions: на Android 14+
  * пользователь должен сам включить «Полноэкранные уведомления», иначе
  * напоминание не покажется поверх блокировки.
  */
 /**
  * Не экономит ли система батарею для приложения.
  *
  * На MIUI, EMUI, OneUI и других прошивках агрессивная экономия батареи
  * выгружает фоновые процессы, и напоминание может не сработать. Проверка
  * нужна, чтобы вовремя подсказать пользователю снять ограничение.
  */
 private boolean batteryOk(){
  try{
   PowerManager pm=(PowerManager)getContext().getSystemService(Context.POWER_SERVICE);
   return pm!=null&&pm.isIgnoringBatteryOptimizations(getContext().getPackageName());
  }catch(Exception e){return true;} // проверить не смогли - не пугаем пользователя
 }

 /**
  * Открывает системный запрос на отключение экономии батареи.
  *
  * На части прошивок диалог открывается напрямую, на остальных показываем
  * общий список приложений. Оба варианта безопасны на любой версии
  * Android начиная с 7.0 (minSdk приложения).
  */
 @PluginMethod public void requestBattery(PluginCall call){
  try{
   Intent i=new Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS,Uri.parse("package:"+getContext().getPackageName()));
   i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
   getContext().startActivity(i);
  }catch(Exception e){
   try{
    Intent i=new Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS);
    i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
    getContext().startActivity(i);
   }catch(Exception ignored){}
  }
  JSObject r=new JSObject();r.put("opened",true);call.resolve(r);
 }

 @PluginMethod public void requestFullscreen(PluginCall call){
  if(Build.VERSION.SDK_INT<34||fullscreenAllowed()){JSObject ok=new JSObject();ok.put("granted",true);call.resolve(ok);return;}
  try{
   Intent i=new Intent(android.provider.Settings.ACTION_MANAGE_APP_USE_FULL_SCREEN_INTENT,Uri.parse("package:"+getContext().getPackageName()));
   i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
   getContext().startActivity(i);
  }catch(Exception e){
   try{getContext().startActivity(new Intent(android.provider.Settings.ACTION_MANAGE_OVERLAY_PERMISSION,Uri.parse("package:"+getContext().getPackageName())).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));}catch(Exception ignored){}
  }
  JSObject r=new JSObject();r.put("opened",true);call.resolve(r);
 }
 @PermissionCallback private void notificationResult(PluginCall call){openExact(call);}
 private void openExact(PluginCall call){if(!NotificationManagerCompat.from(getContext()).areNotificationsEnabled()){permissions(call);return;}if(Build.VERSION.SDK_INT>=31&&!AlarmScheduler.exact(getContext()))getActivity().startActivity(new Intent(Settings.ACTION_REQUEST_SCHEDULE_EXACT_ALARM,Uri.parse("package:"+getContext().getPackageName())));permissions(call);}
 @PluginMethod public void speak(PluginCall call){String text=call.getString("text","");getActivity().runOnUiThread(()->{if(preview!=null)preview.shutdown();preview=new TextToSpeech(getContext(),status->{if(status==TextToSpeech.SUCCESS){preview.setLanguage(new Locale("ru","RU"));preview.speak(text,TextToSpeech.QUEUE_FLUSH,null,"preview");call.resolve();}else call.reject("TTS недоступен");});});}
 @PluginMethod public void recognize(PluginCall call){if(getPermissionState("microphone")!=PermissionState.GRANTED){requestPermissionForAlias("microphone",call,"microphoneResult");return;}startRecognition(call);}
 @PermissionCallback private void microphoneResult(PluginCall call){if(getPermissionState("microphone")!=PermissionState.GRANTED){call.reject("not-allowed");return;}startRecognition(call);}
 private void startRecognition(PluginCall call){getActivity().runOnUiThread(()->{if(recognition!=null){call.reject("Запись уже идёт");return;}if(!SpeechRecognizer.isRecognitionAvailable(getContext())){call.reject("service-not-allowed");return;}recognition=call;recognizer=SpeechRecognizer.createSpeechRecognizer(getContext());recognizer.setRecognitionListener(new RecognitionListener(){public void onReadyForSpeech(Bundle b){notifyListeners("recognitionState",new JSObject().put("status","started"));}public void onBeginningOfSpeech(){}public void onRmsChanged(float x){}public void onBufferReceived(byte[] b){}public void onEndOfSpeech(){}public void onError(int code){PluginCall current=recognition;cleanup();if(current!=null)current.reject(code==SpeechRecognizer.ERROR_INSUFFICIENT_PERMISSIONS?"not-allowed":code==SpeechRecognizer.ERROR_NO_MATCH||code==SpeechRecognizer.ERROR_SPEECH_TIMEOUT?"no-speech":"speech-error-"+code);}public void onResults(Bundle b){ArrayList<String> matches=b.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION);PluginCall current=recognition;cleanup();if(current!=null)current.resolve(new JSObject().put("text",matches!=null&&!matches.isEmpty()?matches.get(0):""));}public void onPartialResults(Bundle b){ArrayList<String> matches=b.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION);if(matches!=null&&!matches.isEmpty())notifyListeners("recognitionPartial",new JSObject().put("text",matches.get(0)));}public void onEvent(int t,Bundle b){}});Intent intent=new Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH).putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL,RecognizerIntent.LANGUAGE_MODEL_FREE_FORM).putExtra(RecognizerIntent.EXTRA_LANGUAGE,"ru-RU").putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS,true).putExtra(RecognizerIntent.EXTRA_MAX_RESULTS,1).putExtra(RecognizerIntent.EXTRA_SPEECH_INPUT_COMPLETE_SILENCE_LENGTH_MILLIS,3600000L).putExtra(RecognizerIntent.EXTRA_SPEECH_INPUT_POSSIBLY_COMPLETE_SILENCE_LENGTH_MILLIS,3600000L).putExtra(RecognizerIntent.EXTRA_SPEECH_INPUT_MINIMUM_LENGTH_MILLIS,3600000L);try{recognizer.startListening(intent);}catch(Exception ex){PluginCall pending=recognition;cleanup();if(pending!=null)pending.reject("speech-start-failed");}});}
 private void cleanup(){recognition=null;if(recognizer!=null){recognizer.destroy();recognizer=null;}notifyListeners("recognitionState",new JSObject().put("status","stopped"));}
 private void playDoneCue(){android.media.ToneGenerator tone=null;try{tone=new android.media.ToneGenerator(android.media.AudioManager.STREAM_MUSIC,55);tone.startTone(android.media.ToneGenerator.TONE_PROP_ACK,150);}catch(Exception ignored){}final android.media.ToneGenerator done=tone;new Handler(Looper.getMainLooper()).postDelayed(()->{if(done!=null)try{done.release();}catch(Exception ignored){}},190);}
 @PluginMethod public void stopRecognition(PluginCall call){getActivity().runOnUiThread(()->{playDoneCue();if(recognizer!=null)recognizer.stopListening();call.resolve();});}
 @PluginMethod public void abortRecognition(PluginCall call){getActivity().runOnUiThread(()->{PluginCall pending=recognition;if(recognizer!=null)recognizer.cancel();cleanup();if(pending!=null)pending.resolve(new JSObject().put("text",""));call.resolve();});}
 @Override protected void handleOnPause(){getActivity().runOnUiThread(()->{PluginCall pending=recognition;if(recognizer!=null)recognizer.cancel();cleanup();if(pending!=null)pending.resolve(new JSObject().put("text",""));});}
 @Override protected void handleOnDestroy(){getActivity().runOnUiThread(()->{if(recognizer!=null)recognizer.destroy();if(preview!=null)preview.shutdown();});}
}
