package ru.voicereminder.app.reminders;
import android.content.*;
import android.app.*;
import android.os.Build;
import org.json.*;
public class AlarmReceiver extends BroadcastReceiver {
 @Override public void onReceive(Context c,Intent intent){String action=intent.getAction();if(action==null)return;if(action.equals(Intent.ACTION_BOOT_COMPLETED)||action.equals(Intent.ACTION_TIME_CHANGED)||action.equals(Intent.ACTION_TIMEZONE_CHANGED)||action.equals(Intent.ACTION_MY_PACKAGE_REPLACED)||action.equals(AlarmManager.ACTION_SCHEDULE_EXACT_ALARM_PERMISSION_STATE_CHANGED)){AlarmScheduler.restore(c);return;}
 String id=intent.getStringExtra("id");if(id==null)return;
 try(ReminderStore db=new ReminderStore(c)){
  if(action.equals(AlarmScheduler.ACK)){ack(c,db,id,"notification");return;}if(action.equals(AlarmScheduler.SNOOZE)){snooze(c,db,id,5);return;}
  JSONObject event;
  if(action.equals(AlarmScheduler.FIRE)){JSONObject r=db.rule(id);if(r==null||!r.optBoolean("enabled",true))return;long scheduled=r.optLong("nextTriggerAt",0);if(scheduled<=0)return;String eid=id+"@"+scheduled;event=db.event(eid);if(event==null){event=new JSONObject().put("id",eid).put("reminderId",id).put("text",r.getString("text")).put("state","ringing").put("scheduledAt",scheduled).put("attemptCount",0);event.put("nativeId",db.put("events","eid",eid,event));}else if(event.optString("state").equals("acknowledged"))return;
   if(r.getJSONObject("schedule").optString("kind").equals("once")){r.put("enabled",false);db.put("rules","rid",id,r);}else AlarmScheduler.plan(c,db,r);
  }else{event=db.event(id);if(event==null||!java.util.Arrays.asList("ringing","waiting","snoozed").contains(event.optString("state")))return;}
  event.put("state","ringing").put("attemptCount",event.optInt("attemptCount")+1).put("deliveredAt",System.currentTimeMillis());db.put("events","eid",event.getString("id"),event);
  JSONObject settings=db.meta("settings");String mode=settings.optString("mode","voiceAndNotification");
  if(!mode.equals("voice"))DeliveryService.notifyEvent(c,event,settings,false);
  if(!mode.equals("notification")){
   try{Intent service=new Intent(c,DeliveryService.class).putExtra("eventId",event.getString("id"));if(Build.VERSION.SDK_INT>=26)c.startForegroundService(service);else c.startService(service);}catch(Exception ex){DeliveryService.notifyEvent(c,event,settings,false);db.diagnostic("Android не разрешил фоновую озвучку: "+ex.getClass().getSimpleName());}
  }
  boolean repeat=settings.optBoolean("repeat",false);int max=settings.optInt("maxAttempts",12);
  if(repeat&&(max==0||event.optInt("attemptCount")<max)){long retry=System.currentTimeMillis()+Math.max(1,settings.optInt("repeatMinutes",5))*60000L;event.put("retryAt",retry);db.put("events","eid",event.getString("id"),event);AlarmScheduler.at(c,AlarmScheduler.RETRY,event.getString("id"),retry);}
 }catch(Exception e){try(ReminderStore db=new ReminderStore(c)){db.diagnostic("Ошибка доставки: "+e.getMessage());}}
 }
 public static void ack(Context c,ReminderStore db,String id,String source)throws Exception{JSONObject e=db.event(id);if(e==null)return;e.put("state","acknowledged").put("ackSource",source).put("acknowledgedAt",System.currentTimeMillis()).put("retryAt",JSONObject.NULL);db.put("events","eid",id,e);AlarmScheduler.cancel(c,AlarmScheduler.RETRY,id);c.getSystemService(NotificationManager.class).cancel(10000+e.optInt("nativeId"));DeliveryService.stopEvent(id);}
 public static void snooze(Context c,ReminderStore db,String id,int minutes)throws Exception{JSONObject e=db.event(id);if(e==null)return;long at=System.currentTimeMillis()+Math.max(1,minutes)*60000L;e.put("state","snoozed").put("retryAt",at);db.put("events","eid",id,e);AlarmScheduler.at(c,AlarmScheduler.RETRY,id,at);c.getSystemService(NotificationManager.class).cancel(10000+e.optInt("nativeId"));DeliveryService.stopEvent(id);}
}
