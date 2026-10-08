package ru.voicereminder.app.reminders;
import android.content.*;
import android.database.*;
import android.database.sqlite.*;
import org.json.*;
import java.time.*;
import java.util.*;
public final class ReminderStore extends SQLiteOpenHelper {
 private final Context context;
 public ReminderStore(Context c){super(c,"raminde.db",null,1);context=c.getApplicationContext();}
 public void onCreate(SQLiteDatabase db){db.execSQL("CREATE TABLE rules (num INTEGER PRIMARY KEY AUTOINCREMENT,rid TEXT UNIQUE NOT NULL,payload TEXT NOT NULL)");db.execSQL("CREATE TABLE events (num INTEGER PRIMARY KEY AUTOINCREMENT,eid TEXT UNIQUE NOT NULL,payload TEXT NOT NULL)");db.execSQL("CREATE TABLE meta (key TEXT PRIMARY KEY,value TEXT NOT NULL)");}
 public void onUpgrade(SQLiteDatabase db,int old,int now){}
 public synchronized JSONObject meta(String key){try(Cursor c=getReadableDatabase().rawQuery("SELECT value FROM meta WHERE key=?",new String[]{key})){if(c.moveToFirst())return new JSONObject(c.getString(0));}catch(Exception ignored){}return new JSONObject();}
 public synchronized void meta(String key,JSONObject value){ContentValues c=new ContentValues();c.put("key",key);c.put("value",value.toString());getWritableDatabase().insertWithOnConflict("meta",null,c,SQLiteDatabase.CONFLICT_REPLACE);}
 public synchronized JSONObject get(String table,String key,String id){try(Cursor c=getReadableDatabase().rawQuery("SELECT num,payload FROM "+table+" WHERE "+key+"=?",new String[]{id})){if(c.moveToFirst()){JSONObject j=new JSONObject(c.getString(1));j.put("nativeId",c.getInt(0));return j;}}catch(Exception ignored){}return null;}
 public JSONObject rule(String id){return get("rules","rid",id);}public JSONObject event(String id){return get("events","eid",id);}
 public synchronized JSONArray all(String table){JSONArray result=new JSONArray();try(Cursor c=getReadableDatabase().rawQuery("SELECT num,payload FROM "+table+" ORDER BY num",null)){while(c.moveToNext()){try{JSONObject j=new JSONObject(c.getString(1));j.put("nativeId",c.getInt(0));result.put(j);}catch(Exception ignored){}}}return result;}
 public synchronized int put(String table,String key,String id,JSONObject value)throws JSONException {ContentValues c=new ContentValues();c.put(key,id);c.put("payload",value.toString());int updated=getWritableDatabase().update(table,c,key+"=?",new String[]{id});if(updated==0)getWritableDatabase().insertOrThrow(table,null,c);return get(table,key,id).getInt("nativeId");}
 public synchronized JSONObject quota(){JSONObject q=meta("quota");try{String tz=q.optString("timezone",ZoneId.systemDefault().getId()),month=YearMonth.now(ZoneId.of(tz)).toString();if(!q.optString("month").equals(month)){q.put("month",month);q.put("used",0);}q.put("timezone",tz);meta("quota",q);}catch(Exception ignored){}return q;}
 public synchronized JSONObject state(){JSONObject result=new JSONObject();try{result.put("reminders",all("rules"));result.put("events",all("events"));result.put("settings",meta("settings"));result.put("quota",quota());result.put("errors",meta("diagnostic"));JSONObject recovery=meta("restoreStatus");JSONObject boot=meta("bootSignal");int currentBoot=bootCount();recovery.put("bootConfirmed",currentBoot>=0&&boot.optInt("bootCount",-2)==currentBoot).put("bootReceivedAt",boot.optLong("receivedAt",0)).put("currentBootCount",currentBoot).put("appVersion",ru.voicereminder.app.BuildConfig.VERSION_NAME);recovery.put("bootRestore",meta("bootRestoreStatus"));result.put("recovery",recovery);}catch(Exception ignored){}return result;}
 public synchronized void removeRule(String id){getWritableDatabase().delete("rules","rid=?",new String[]{id});JSONArray events=all("events");for(int i=0;i<events.length();i++){JSONObject e=events.optJSONObject(i);if(e.optString("reminderId").equals(id))getWritableDatabase().delete("events","eid=?",new String[]{e.optString("id")});}}
 private int bootCount(){try{return android.provider.Settings.Global.getInt(context.getContentResolver(),android.provider.Settings.Global.BOOT_COUNT);}catch(Exception ex){return -1;}}
 public synchronized void writeRestoreStatus(JSONObject status)throws JSONException{meta("restoreStatus",status);if(Intent.ACTION_BOOT_COMPLETED.equals(status.optString("source")))meta("bootRestoreStatus",status);}
 public synchronized void recordRestoreSignal(String action)throws JSONException{if(Intent.ACTION_BOOT_COMPLETED.equals(action))meta("bootSignal",new JSONObject().put("bootCount",bootCount()).put("receivedAt",System.currentTimeMillis()));}
 public synchronized void diagnostic(String message){JSONObject j=new JSONObject();try{j.put("message",message);j.put("at",System.currentTimeMillis());meta("diagnostic",j);}catch(Exception ignored){}}
}
