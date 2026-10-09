package ru.voicereminder.app;
import android.os.Bundle;
import com.getcapacitor.BridgeActivity;
import ru.voicereminder.app.reminders.ReminderPlugin;
public class MainActivity extends BridgeActivity {
 @Override public void onCreate(Bundle state) { registerPlugin(ReminderPlugin.class); super.onCreate(state); }
}
