package ru.voicereminder.app.reminders;
import android.app.*;
import android.content.*;
import android.net.Uri;
import android.os.Build;
import ru.voicereminder.app.MainActivity;
import org.json.*;
public final class AlarmScheduler {
 public static final String FIRE="ru.voicereminder.FIRE",RETRY="ru.voicereminder.RETRY",ACK="ru.voicereminder.ACK",SNOOZE="ru.voicereminder.SNOOZE";
 public static PendingIntent pending(Context c,String action,String id){Intent i=new Intent(c,AlarmReceiver.class).setAction(action).setData(Uri.parse("raminde://"+action+"/"+Uri.encode(id))).putExtra("id",id);return PendingIntent.getBroadcast(c,0,i,PendingIntent.FLAG_UPDATE_CURRENT|PendingIntent.FLAG_IMMUTABLE);}
 public static boolean exact(Context c){return Build.VERSION.SDK_INT<31||c.getSystemService(AlarmManager.class).canScheduleExactAlarms();}
 public static void at(Context c,String action,String id,long time){AlarmManager am=c.getSystemService(AlarmManager.class);if(!exact(c))throw new IllegalStateException("Разрешите точные будильники в настройках Android");// User-requested reminder: AlarmClock alarms wake the device even in idle.
 // Android may display a next-alarm icon; the show intent opens the reminder list.
 Intent show=new Intent(c,MainActivity.class).setFlags(Intent.FLAG_ACTIVITY_NEW_TASK|Intent.FLAG_ACTIVITY_SINGLE_TOP);
 PendingIntent showIntent=PendingIntent.getActivity(c,0,show,PendingIntent.FLAG_UPDATE_CURRENT|PendingIntent.FLAG_IMMUTABLE);
 am.setAlarmClock(new AlarmManager.AlarmClockInfo(time,showIntent),pending(c,action,id));}
 public static void cancel(Context c,String action,String id){c.getSystemService(AlarmManager.class).cancel(pending(c,action,id));}
 public static void plan(Context c,ReminderStore db,JSONObject rule)throws Exception {cancel(c,FIRE,rule.getString("id"));long next=rule.optBoolean("enabled",true)?ScheduleEngine.next(rule.getJSONObject("schedule"),System.currentTimeMillis()):0;rule.put("nextTriggerAt",next>0?next:JSONObject.NULL);if(next==0)rule.put("enabled",false);db.put("rules","rid",rule.getString("id"),rule);if(next>0)at(c,FIRE,rule.getString("id"),next);}
 public static void restore(Context c){try(ReminderStore db=new ReminderStore(c)){if(!exact(c)){db.diagnostic("Точные будильники отключены. Откройте настройки приложения.");return;}JSONArray rules=db.all("rules");for(int i=0;i<rules.length();i++){JSONObject r=rules.optJSONObject(i);long previous=r.optLong("nextTriggerAt",0),now=System.currentTimeMillis();try{if(r.optBoolean("enabled")&&previous>0&&previous<=now){if(now-previous<=30*60000L){at(c,FIRE,r.getString("id"),now+1000);continue;}if(r.getJSONObject("schedule").optString("kind").equals("once")){r.put("enabled",false);db.diagnostic("Пропущено напоминание: откройте приложение для проверки");}}plan(c,db,r);}catch(Exception e){db.diagnostic(e.getMessage());}}
 JSONArray events=db.all("events");for(int i=0;i<events.length();i++){JSONObject e=events.optJSONObject(i);String state=e.optString("state");if(state.equals("snoozed")||state.equals("ringing")||state.equals("waiting")){long next=e.optLong("retryAt",0);if(next>0)at(c,RETRY,e.getString("id"),Math.max(next,System.currentTimeMillis()+1000));}}
 }catch(Exception ignored){}}
}
