package ru.voicereminder.app.reminders;
import org.junit.Test;import static org.junit.Assert.*;import org.json.*;import java.time.*;
public class DateGroupsTest {
 private JSONObject rule()throws Exception{return new JSONObject("{\"kind\":\"dates\",\"timezoneMode\":\"fixed\",\"timezone\":\"UTC\",\"dates\":[\"2026-10-08\",\"2026-10-11\"],\"times\":[\"09:00\",\"11:00\",\"20:00\"]}");}
 @Test public void sixOccurrences()throws Exception{JSONObject s=rule();long t=Instant.parse("2026-10-07T06:00:00Z").toEpochMilli();for(int i=0;i<6;i++){long n=ScheduleEngine.next(s,t);assertTrue(n>t);t=n;}assertEquals(0,ScheduleEngine.next(s,t));}
 @Test public void skipOne()throws Exception{JSONObject s=rule();long after=Instant.parse("2026-10-07T06:00:00Z").toEpochMilli(),t=ScheduleEngine.next(s,after);s.put("excludedInstants",new JSONArray().put(t));assertEquals(Instant.parse("2026-10-08T11:00:00Z").toEpochMilli(),ScheduleEngine.next(s,after));}
 @Test public void invalidDateDoesNotSchedule()throws Exception{JSONObject s=rule().put("dates",new JSONArray().put("2026-02-30"));assertEquals(0,ScheduleEngine.next(s,0));}
}
