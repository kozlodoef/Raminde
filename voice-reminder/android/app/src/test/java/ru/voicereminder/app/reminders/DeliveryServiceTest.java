package ru.voicereminder.app.reminders;
import org.json.*;
import org.junit.Test;
import static org.junit.Assert.*;

public class DeliveryServiceTest {
 @Test public void alertChannelIsSeparateFromForegroundAndUsesStableSettings() throws Exception{
  JSONObject settings=new JSONObject().put("sound",true).put("vibration",true).put("privateNotification",false);
  assertEquals("remindme_alert_v2_sound_v_public",DeliveryService.channelId(settings,false));
  assertEquals("remindme_foreground_v2",DeliveryService.channelId(settings,true));
 }
 @Test public void privateAlertChannelIsDistinct() throws Exception{
  JSONObject settings=new JSONObject().put("sound",false).put("vibration",false).put("privateNotification",true);
  assertEquals("remindme_alert_v2_silent_n_private",DeliveryService.channelId(settings,false));
 }
}
