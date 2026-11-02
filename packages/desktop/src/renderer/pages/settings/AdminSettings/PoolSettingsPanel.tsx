/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { Button, InputNumber, Message, Switch } from '@arco-design/web-react';
import React, { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ipcBridge } from '@/common';
import type { IPoolSettings } from '@/common/types/auth';

/**
 * Shared-pool settings tab of the admin console: toggle the shared key
 * service and set the daily request cap, saved via PUT /api/admin/pool-settings.
 */
const PoolSettingsPanel: React.FC = () => {
  const { t } = useTranslation();
  const [settings, setSettings] = useState<IPoolSettings | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, messageContext] = Message.useMessage();

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const value = await ipcBridge.admin.poolSettings.get.invoke();
      setSettings(value ?? { shared_key_service_enabled: false, shared_pool_daily_request_cap: 0 });
    } catch (error) {
      console.error('Failed to load pool settings:', error);
      message.error(t('settings.admin.pool.loadFailed'));
    } finally {
      setLoading(false);
    }
  }, [message, t]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const handleSave = async () => {
    if (!settings) return;
    setSaving(true);
    try {
      const saved = await ipcBridge.admin.poolSettings.update.invoke({
        shared_key_service_enabled: settings.shared_key_service_enabled,
        shared_pool_daily_request_cap: Math.max(0, Math.floor(settings.shared_pool_daily_request_cap || 0)),
      });
      setSettings(saved ?? settings);
      message.success(t('settings.admin.pool.saved'));
    } catch (error) {
      console.error('Failed to save pool settings:', error);
      message.error(t('settings.admin.pool.saveFailed'));
    } finally {
      setSaving(false);
    }
  };

  if (loading || !settings) {
    return <div className='text-13px text-t-tertiary py-24px text-center'>{t('common.loading')}</div>;
  }

  return (
    <div className='flex flex-col gap-12px max-w-560px'>
      {messageContext}

      <div className='flex items-center justify-between gap-12px py-8px'>
        <div className='min-w-0 flex-1'>
          <div className='text-14px text-t-primary'>{t('settings.admin.pool.sharedEnabled')}</div>
          <div className='text-12px text-t-tertiary mt-2px'>{t('settings.admin.pool.sharedEnabledDesc')}</div>
        </div>
        <Switch
          size='small'
          checked={settings.shared_key_service_enabled}
          onChange={(checked) => {
            setSettings((prev) => (prev ? { ...prev, shared_key_service_enabled: checked } : prev));
          }}
        />
      </div>

      <div className='flex items-center justify-between gap-12px py-8px'>
        <div className='min-w-0 flex-1'>
          <div className='text-14px text-t-primary'>{t('settings.admin.pool.dailyCap')}</div>
          <div className='text-12px text-t-tertiary mt-2px'>{t('settings.admin.pool.dailyCapDesc')}</div>
        </div>
        <InputNumber
          size='small'
          style={{ width: 140 }}
          min={0}
          precision={0}
          value={settings.shared_pool_daily_request_cap}
          disabled={!settings.shared_key_service_enabled}
          onChange={(value) => {
            setSettings((prev) => (prev ? { ...prev, shared_pool_daily_request_cap: Number(value) || 0 } : prev));
          }}
        />
      </div>

      <div className='flex justify-end mt-4px'>
        <Button type='primary' loading={saving} onClick={() => void handleSave()}>
          {t('common.save')}
        </Button>
      </div>
    </div>
  );
};

export default PoolSettingsPanel;
