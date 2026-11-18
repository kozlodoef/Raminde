package ru.voicereminder.app;
import android.os.Bundle;
import com.getcapacitor.BridgeActivity;
import ru.voicereminder.app.reminders.ReminderPlugin;
import ru.voicereminder.app.reminders.VoskRecognitionPlugin;
public class MainActivity extends BridgeActivity {
 @Override public void onCreate(Bundle state) { registerPlugin(ReminderPlugin.class); registerPlugin(VoskRecognitionPlugin.class); super.onCreate(state); }
}
