package com.example.dshapp;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(TaskNotificationsPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
