package com.vaultonotemobile;

import android.content.Context;
import android.content.Intent;
import android.content.pm.ShortcutInfo;
import android.content.pm.ShortcutManager;
import android.graphics.drawable.Icon;
import android.net.Uri;
import android.os.Build;
import com.facebook.react.bridge.Arguments;
import com.facebook.react.bridge.Promise;
import com.facebook.react.bridge.ReadableMap;
import com.facebook.react.bridge.ReadableMapKeySetIterator;
import com.facebook.react.bridge.WritableMap;
import java.util.ArrayList;
import com.facebook.react.bridge.ReactApplicationContext;
import com.facebook.react.bridge.ReactContextBaseJavaModule;
import com.facebook.react.bridge.ReactMethod;

public class NoteShortcutModule extends ReactContextBaseJavaModule {
    private static final String NOTE_PREFIX = "note-";

    NoteShortcutModule(ReactApplicationContext context) {
        super(context);
    }

    @Override
    public String getName() {
        return "NoteShortcut";
    }

    @ReactMethod
    public void getPinnedLabels(Promise promise) {
        try {
            WritableMap labels = Arguments.createMap();
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                ShortcutManager manager = getReactApplicationContext().getSystemService(ShortcutManager.class);
                if (manager != null) {
                    for (ShortcutInfo item : manager.getPinnedShortcuts()) {
                        if (!item.isImmutable() && item.getId().startsWith(NOTE_PREFIX)) {
                            labels.putString(item.getId().substring(NOTE_PREFIX.length()),
                                String.valueOf(item.getShortLabel()));
                        }
                    }
                }
            }
            promise.resolve(labels);
        } catch (RuntimeException e) {
            promise.reject("SHORTCUT_QUERY_FAILED", e);
        }
    }

    @ReactMethod
    public void updateLabels(ReadableMap labels, Promise promise) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) {
            promise.resolve(false);
            return;
        }
        try {
            Context context = getReactApplicationContext();
            ShortcutManager manager = context.getSystemService(ShortcutManager.class);
            ArrayList<ShortcutInfo> updates = new ArrayList<>();
            ReadableMapKeySetIterator keys = labels.keySetIterator();
            while (keys.hasNextKey()) {
                String key = keys.nextKey();
                updates.add(new ShortcutInfo.Builder(context, NOTE_PREFIX + key)
                    .setShortLabel(labels.getString(key))
                    .build());
            }
            promise.resolve(manager != null && manager.updateShortcuts(updates));
        } catch (RuntimeException e) {
            promise.reject("SHORTCUT_UPDATE_FAILED", e);
        }
    }

    @ReactMethod
    public void requestPin(String noteId, String label, Promise promise) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) {
            promise.resolve(false);
            return;
        }
        try {
            Context context = getReactApplicationContext();
            ShortcutManager manager = context.getSystemService(ShortcutManager.class);
            if (manager == null || !manager.isRequestPinShortcutSupported()) {
                promise.resolve(false);
                return;
            }
            Uri uri = new Uri.Builder().scheme("vaultonote").authority("shortcut").appendPath(noteId).build();
            Intent intent = new Intent(Intent.ACTION_VIEW, uri, context, MainActivity.class);
            ShortcutInfo shortcut = new ShortcutInfo.Builder(context, NOTE_PREFIX + noteId)
                .setShortLabel(label)
                .setIntent(intent)
                .setIcon(Icon.createWithResource(context, R.mipmap.ic_launcher))
                .build();
            promise.resolve(manager.requestPinShortcut(shortcut, null));
        } catch (RuntimeException e) {
            promise.reject("SHORTCUT_FAILED", e);
        }
    }
}
