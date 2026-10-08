package ru.voicereminder.app.reminders;
import org.junit.Test;import static org.junit.Assert.*;
public class RestoreReceiverTest {
 @Test public void bootAccepted(){assertTrue(RestoreReceiver.accepts("android.intent.action.BOOT_COMPLETED"));}
 @Test public void timeAndUpdateAccepted(){assertTrue(RestoreReceiver.accepts("android.intent.action.TIME_SET"));assertTrue(RestoreReceiver.accepts("android.intent.action.TIMEZONE_CHANGED"));assertTrue(RestoreReceiver.accepts("android.intent.action.MY_PACKAGE_REPLACED"));}
 @Test public void reminderActionsRejected(){assertFalse(RestoreReceiver.accepts(AlarmScheduler.FIRE));assertFalse(RestoreReceiver.accepts(AlarmScheduler.ACK));assertFalse(RestoreReceiver.accepts(AlarmScheduler.SNOOZE));assertFalse(RestoreReceiver.accepts(AlarmScheduler.RETRY));}
 @Test public void arbitraryActionsRejected(){assertFalse(RestoreReceiver.accepts(null));assertFalse(RestoreReceiver.accepts("fake.boot"));}
}
