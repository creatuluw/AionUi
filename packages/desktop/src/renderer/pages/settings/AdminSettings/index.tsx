/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { Tabs } from '@arco-design/web-react';
import React from 'react';
import { useTranslation } from 'react-i18next';
import { Navigate } from 'react-router-dom';
import { useAuth } from '@renderer/hooks/context/AuthContext';
import SettingsPageHeader from '@renderer/pages/settings/components/SettingsPageHeader';
import SettingsPageWrapper from '@renderer/pages/settings/components/SettingsPageWrapper';
import InvitesPanel from './InvitesPanel';
import PoolSettingsPanel from './PoolSettingsPanel';
import UsersPanel from './UsersPanel';

/**
 * Admin console (WebUI multi-user mode). Reachable only with role === 'admin';
 * the backend enforces the same rule on every /api/admin/* route.
 */
const AdminSettings: React.FC = () => {
  const { t } = useTranslation();
  const { user } = useAuth();

  if (user?.role !== 'admin') {
    return <Navigate to='/guid' replace />;
  }

  return (
    <SettingsPageWrapper>
      <div className='flex flex-col gap-16px'>
        <SettingsPageHeader title={t('settings.admin.title')} description={t('settings.admin.description')} />
        <Tabs defaultActiveTab='users' destroyOnHide size='small'>
          <Tabs.TabPane key='users' title={t('settings.admin.tabs.users')}>
            <UsersPanel />
          </Tabs.TabPane>
          <Tabs.TabPane key='invites' title={t('settings.admin.tabs.invites')}>
            <InvitesPanel />
          </Tabs.TabPane>
          <Tabs.TabPane key='pool' title={t('settings.admin.tabs.pool')}>
            <PoolSettingsPanel />
          </Tabs.TabPane>
        </Tabs>
      </div>
    </SettingsPageWrapper>
  );
};

export default AdminSettings;
