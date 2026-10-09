package ru.voicereminder.app.reminders;
import org.junit.Test;import static org.junit.Assert.*;import org.json.*;import java.time.*;
public class ScheduleEngineTest {
 private JSONObject base()throws Exception{return new JSONObject("{\"kind\":\"calendar\",\"frequency\":\"daily\",\"anchorDate\":\"2026-10-01\",\"timezoneMode\":\"fixed\",\"timezone\":\"UTC\",\"interval\":1,\"times\":[\"09:00\"],\"dayParity\":\"any\"}");}
 private long at(String s){return Instant.parse(s).toEpochMilli();}
 @Test public void daily()throws Exception{assertEquals(at("2026-10-08T09:00:00Z"),ScheduleEngine.next(base(),at("2026-10-07T12:00:00Z")));}
 @Test public void monday()throws Exception{assertEquals(at("2026-10-12T09:00:00Z"),ScheduleEngine.next(base().put("frequency","weekly").put("weekdays",new JSONArray("[1]")),at("2026-10-07T12:00:00Z")));}
 @Test public void monthly31()throws Exception{assertEquals(at("2026-12-31T09:00:00Z"),ScheduleEngine.next(base().put("frequency","monthly").put("monthDays",new JSONArray("[31]")),at("2026-11-01T00:00:00Z")));}
 @Test public void leapDay()throws Exception{assertEquals(at("2028-02-29T09:00:00Z"),ScheduleEngine.next(base().put("frequency","yearly").put("monthDays",new JSONArray("[29]")).put("months",new JSONArray("[2]")),at("2026-10-01T00:00:00Z")));}
 @Test public void oddMonthBoundary()throws Exception{JSONObject s=base().put("dayParity","odd");long first=ScheduleEngine.next(s,at("2027-01-30T23:00:00Z"));assertEquals(at("2027-01-31T09:00:00Z"),first);assertEquals(at("2027-02-01T09:00:00Z"),ScheduleEngine.next(s,first));}
 @Test public void lastFriday()throws Exception{assertEquals(at("2026-10-30T09:00:00Z"),ScheduleEngine.next(base().put("frequency","monthly").put("ordinal",-1).put("weekday",5),at("2026-10-07T12:00:00Z")));}
 @Test public void countEnds()throws Exception{assertEquals(0,ScheduleEngine.next(base().put("count",2),at("2026-10-07T12:00:00Z")));}
 @Test public void gap()throws Exception{assertEquals(at("2026-03-29T01:00:00Z"),ScheduleEngine.next(base().put("anchorDate","2026-03-29").put("timezone","Europe/Berlin").put("times",new JSONArray("[\"02:30\"]")),at("2026-03-29T00:00:00Z")));}
 @Test public void overlap()throws Exception{assertEquals(at("2026-10-25T00:30:00Z"),ScheduleEngine.next(base().put("timezone","Europe/Berlin").put("times",new JSONArray("[\"02:30\"]")),at("2026-10-25T00:00:00Z")));}
}
