package ru.voicereminder.app.reminders;
import org.json.*;
import java.time.*;
import java.time.zone.*;
import java.util.*;
/** Pure calendar engine shared contract with src/domain/calendar.js. */
public final class ScheduleEngine {
 private static boolean contains(JSONArray a,int n){if(a==null)return false;for(int i=0;i<a.length();i++)if(a.optInt(i)==n)return true;return false;}
 private static boolean contains(JSONArray a,String n){if(a==null)return false;for(int i=0;i<a.length();i++)if(a.optString(i).equals(n))return true;return false;}
 private static boolean excluded(JSONObject s,long t){JSONArray a=s.optJSONArray("excludedInstants");if(a!=null)for(int i=0;i<a.length();i++)if(a.optLong(i)==t)return true;return false;}
 private static boolean populated(JSONArray a){return a!=null&&a.length()>0;}
 private static long wall(LocalDate day,String time,ZoneId zone){LocalDateTime dt=LocalDateTime.of(day,LocalTime.parse(time));ZoneRules rules=zone.getRules();List<ZoneOffset> offsets=rules.getValidOffsets(dt);if(offsets.isEmpty()){ZoneOffsetTransition transition=rules.getTransition(dt);return transition.getDateTimeAfter().atZone(zone).toInstant().toEpochMilli();}return dt.atOffset(offsets.get(0)).toInstant().toEpochMilli();}
 public static long next(JSONObject s,long after){
  try{
   String kind=s.optString("kind");if(kind.equals("once")){long t=Instant.parse(s.getString("at")).toEpochMilli();return t>after&&!excluded(s,t)?t:0;}
   ZoneId zone=s.optString("timezoneMode").equals("fixed")?ZoneId.of(s.getString("timezone")):ZoneId.systemDefault();
   if(kind.equals("dates")){long best=Long.MAX_VALUE;JSONArray dates=s.getJSONArray("dates"),times=s.getJSONArray("times");for(int i=0;i<dates.length();i++)for(int j=0;j<times.length();j++){LocalDate day=LocalDate.parse(dates.getString(i));long t=wall(day,times.getString(j),zone);if(t>after&&t<best&&!excluded(s,t)&&!contains(s.optJSONArray("excludedDates"),day.toString()))best=t;}return best==Long.MAX_VALUE?0:best;}
   LocalDate anchor=LocalDate.parse(s.getString("anchorDate")),until=s.isNull("until")||s.optString("until").isEmpty()?LocalDate.MAX:LocalDate.parse(s.getString("until"));long count=s.optLong("count",0);JSONArray excludes=s.optJSONArray("excludedDates");
   if(kind.equals("interval")){long start=Instant.parse(s.getString("startAt")).toEpochMilli(),step=s.getLong("intervalMinutes")*60000;if(step<60000)return 0;long index=Math.max(0,(after-start)/step+1);for(int n=0;n<100000;n++,index++){if(count>0&&index>=count)return 0;long t=start+index*step;ZonedDateTime z=Instant.ofEpochMilli(t).atZone(zone);if(z.toLocalDate().isAfter(until))return 0;String hm=z.toLocalTime().toString().substring(0,5);if(!s.optString("windowStart").isEmpty()&&hm.compareTo(s.getString("windowStart"))<0||!s.optString("windowEnd").isEmpty()&&hm.compareTo(s.getString("windowEnd"))>0||contains(excludes,z.toLocalDate().toString()))continue;if(!excluded(s,t))return t;}return 0;}
   long step=Math.max(1,s.optLong("interval",1)),emitted=0;String frequency=s.optString("frequency","daily");LocalDate start=count>0?anchor:Instant.ofEpochMilli(after).atZone(zone).toLocalDate();if(start.isBefore(anchor))start=anchor;
   TreeSet<String> times=new TreeSet<>();JSONArray ts=s.getJSONArray("times");for(int i=0;i<ts.length();i++)times.add(ts.getString(i));
   LocalDate anchorMonday=anchor.minusDays(anchor.getDayOfWeek().getValue()-1);
   LocalDate boundary=Instant.ofEpochMilli(after).atZone(zone).toLocalDate().plusYears(frequency.equals("yearly")?Math.max(12,step+1):frequency.equals("weekly")?Math.max(12,step/52+2):frequency.equals("monthly")?Math.max(12,step/12+2):12);
   for(LocalDate day=start;day.isBefore(boundary)&&!day.isAfter(until);day=day.plusDays(1)){
    int wd=day.getDayOfWeek().getValue(),md=day.getDayOfMonth(),month=day.getMonthValue();long days=java.time.temporal.ChronoUnit.DAYS.between(anchor,day),months=(day.getYear()-anchor.getYear())*12L+month-anchor.getMonthValue();
    if(contains(excludes,day.toString())||contains(s.optJSONArray("excludedWeekdays"),wd))continue;
    if(populated(s.optJSONArray("weekdays"))&&!contains(s.optJSONArray("weekdays"),wd)||populated(s.optJSONArray("monthDays"))&&!contains(s.optJSONArray("monthDays"),md)||populated(s.optJSONArray("months"))&&!contains(s.optJSONArray("months"),month))continue;
    String parity=s.optString("dayParity","any");if(parity.equals("even")&&md%2!=0||parity.equals("odd")&&md%2!=1)continue;
    if(s.optBoolean("lastDay")&&md!=day.lengthOfMonth())continue;
    int ordinal=s.optInt("ordinal",0);if(ordinal!=0&&(wd!=s.optInt("weekday")||(ordinal==-1?day.plusDays(7).getMonth().equals(day.getMonth()):(md-1)/7+1!=ordinal)))continue;
    if(frequency.equals("daily")&&days%step!=0||frequency.equals("weekly")&&(java.time.temporal.ChronoUnit.DAYS.between(anchorMonday,day)/7)%step!=0||frequency.equals("monthly")&&months%step!=0||frequency.equals("yearly")&&(day.getYear()-anchor.getYear())%step!=0)continue;
    for(String time:times){long t=wall(day,time,zone);emitted++;if(count>0&&emitted>count)return 0;if(t>after&&!excluded(s,t))return t;}
   }
  }catch(Exception ignored){return 0;}return 0;
 }
}
