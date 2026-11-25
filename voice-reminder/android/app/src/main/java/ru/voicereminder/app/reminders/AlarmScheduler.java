package ru.voicereminder.app.reminders;
import android.app.*;
import android.content.*;
import android.net.Uri;
import android.os.Build;
import ru.voicereminder.app.MainActivity;
import org.json.*;
public final class AlarmScheduler {
 public static final String FIRE="ru.voicereminder.FIRE",RETRY="ru.voicereminder.RETRY",ACK="ru.voicereminder.ACK",SNOOZE="ru.voicereminder.SNOOZE",DISMISS="ru.voicereminder.DISMISS";
 public static PendingIntent pending(Context c,String action,String id){Intent i=new Intent(c,AlarmReceiver.class).setAction(action).setData(Uri.parse("raminde://"+action+"/"+Uri.encode(id))).putExtra("id",id);return PendingIntent.getBroadcast(c,0,i,PendingIntent.FLAG_UPDATE_CURRENT|PendingIntent.FLAG_IMMUTABLE);}
 public static boolean exact(Context c){return Build.VERSION.SDK_INT<31||c.getSystemService(AlarmManager.class).canScheduleExactAlarms();}
 public static void at(Context c,String action,String id,long time){AlarmManager am=c.getSystemService(AlarmManager.class);
  // Точные будильники (Android 12+) требуют отдельного разрешения. Если его
  // нет, раньше бросали исключение и напоминание НЕ ставилось вообще:
  // пользователь молча не получал ничего. Для главной функции приложения
  // это недопустимо, поэтому есть запасной путь.
  if(!exact(c)){fallback(c,am,action,id,time);return;}
  // User-requested reminder: AlarmClock alarms wake the device even in idle.
 // Android may display a next-alarm icon; the show intent opens the reminder list.
 Intent show=new Intent(c,MainActivity.class).setFlags(Intent.FLAG_ACTIVITY_NEW_TASK|Intent.FLAG_ACTIVITY_SINGLE_TOP);
 PendingIntent showIntent=PendingIntent.getActivity(c,0,show,PendingIntent.FLAG_UPDATE_CURRENT|PendingIntent.FLAG_IMMUTABLE);
 am.setAlarmClock(new AlarmManager.AlarmClockInfo(time,showIntent),pending(c,action,id));}
 public static void cancel(Context c,String action,String id){c.getSystemService(AlarmManager.class).cancel(pending(c,action,id));}

 /**
  * Запасной будильник, когда точные запрещены.
  *
  * setAndAllowWhileIdle будит устройство даже в Doze, но система может сдвинуть
  * срабатывание на несколько минут: это лучше, чем пропустить напоминание
  * полностью. Метод есть с API 23, поэтому приложение ставится на Android
  * 7.0+ без дополнительных проверок версии.
  */
 private static void fallback(Context c,AlarmManager am,String action,String id,long time){
  try{am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP,time,pending(c,action,id));}
  catch(Exception e){
   // Совсем старые прошивки: обычный set тоже лучше, чем ничего.
   try{am.set(AlarmManager.RTC_WAKEUP,time,pending(c,action,id));}catch(Exception ignored){}
  }
  try(ReminderStore db=new ReminderStore(c)){db.diagnostic("Точные будильники запрещены: напоминание поставлено с возможной задержкой");}catch(Exception ignored){}
 }
 public static void plan(Context c,ReminderStore db,JSONObject rule)throws Exception {cancel(c,FIRE,rule.getString("id"));long next=rule.optBoolean("enabled",true)?ScheduleEngine.next(rule.getJSONObject("schedule"),System.currentTimeMillis()):0;rule.put("nextTriggerAt",next>0?next:JSONObject.NULL);if(next==0)rule.put("enabled",false);db.put("rules","rid",rule.getString("id"),rule);if(next>0)at(c,FIRE,rule.getString("id"),next);}
 public static void restore(Context c){restore(c,"app_resume");}
 public static void restore(Context c,String source){
  try(ReminderStore db=new ReminderStore(c)){
   // Заодно убираем старые записи о срабатываниях. Подтверждённое
   // срабатывание раньше оставалось в базе навсегда и копилось годами, а
   // state() отдавал всё это в JS. Живые записи (звонящие, ждущие реакции и
   // отложенные) не трогаются — это текущие напоминания.
   try{db.pruneEvents(30);}catch(Exception ignored){}
   JSONObject status=db.meta("restoreStatus");
   status.put("source",source).put("startedAt",System.currentTimeMillis()).put("completedAt",JSONObject.NULL).put("scheduled",0).put("error",JSONObject.NULL);
   db.writeRestoreStatus(status);
   // Точные будильники запрещены — не выходим, а ставим неточные через
   // fallback внутри at(). Иначе после перезагрузки телефона не встало бы
   // ни одно напоминание, хотя пользователь их создавал.
   if(!exact(c)){status.put("error","Точные будильники отключены: напоминания могут срабатывать с задержкой");db.writeRestoreStatus(status);db.diagnostic("Точные будильники отключены. Откройте настройки приложения.");}
   int scheduledCount=0;String lastError=null;
   JSONArray rules=db.all("rules");
   for(int i=0;i<rules.length();i++){
    JSONObject r=rules.optJSONObject(i);if(r==null||!r.optBoolean("enabled",true))continue;
    long previous=r.optLong("nextTriggerAt",0),now=System.currentTimeMillis();
    try{
     if(previous>0&&previous<=now){
      if(now-previous<=30*60000L){at(c,FIRE,r.getString("id"),now+1000);scheduledCount++;continue;}
      if(r.getJSONObject("schedule").optString("kind").equals("once")){r.put("enabled",false);db.put("rules","rid",r.getString("id"),r);db.diagnostic("Пропущено напоминание: откройте приложение для проверки");continue;}
     }
     plan(c,db,r);if(r.optLong("nextTriggerAt",0)>0)scheduledCount++;
    }catch(Exception e){lastError=e.getClass().getSimpleName()+": "+e.getMessage();db.diagnostic("Ошибка восстановления: "+lastError);}
   }
   JSONArray events=db.all("events");
   for(int i=0;i<events.length();i++){
    JSONObject e=events.optJSONObject(i);String state=e.optString("state");
    if(state.equals("snoozed")||state.equals("ringing")||state.equals("waiting")){
     long next=e.optLong("retryAt",0);
     if(next>0)try{at(c,RETRY,e.getString("id"),Math.max(next,System.currentTimeMillis()+1000));scheduledCount++;}catch(Exception ex){lastError=ex.getClass().getSimpleName()+": "+ex.getMessage();db.diagnostic("Ошибка восстановления повтора: "+lastError);}
    }
   }
   status.put("scheduled",scheduledCount).put("completedAt",System.currentTimeMillis()).put("error",lastError==null?JSONObject.NULL:lastError);db.writeRestoreStatus(status);
  }catch(Exception ex){android.util.Log.e("RemindMeRestore","Restore failed",ex);try(ReminderStore db=new ReminderStore(c)){db.diagnostic("Ошибка восстановления: "+ex.getClass().getSimpleName()+": "+ex.getMessage());}catch(Exception ignored){}}
 }
}
