/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { Button, Form, Input, Message, Modal, Popconfirm, Select, Table, Tag, Tooltip } from '@arco-design/web-react';
import { Block, Plus, User, Unlock } from '@icon-park/react';
import React, { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ipcBridge } from '@/common';
import type { AuthRole, IAdminUser } from '@/common/types/auth';
import { useAuth } from '@renderer/hooks/context/AuthContext';

/**
 * Users tab of the admin console: list users, provision new ones, change
 * roles, disable/enable, reset passwords. Every action routes through
 * /api/admin/users/*; the backend re-checks the caller's role.
 */
const UsersPanel: React.FC = () => {
  const { t } = useTranslation();
  const { user: currentUser } = useAuth();
  const [users, setUsers] = useState<IAdminUser[]>([]);
  const [loading, setLoading] = useState(false);
  const [provisionVisible, setProvisionVisible] = useState(false);
  const [provisionLoading, setProvisionLoading] = useState(false);
  const [passwordTarget, setPasswordTarget] = useState<IAdminUser | null>(null);
  const [passwordLoading, setPasswordLoading] = useState(false);
  const [provisionForm] = Form.useForm();
  const [passwordForm] = Form.useForm();
  const [message, messageContext] = Message.useMessage();

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const list = await ipcBridge.admin.users.list.invoke();
      setUsers(list ?? []);
    } catch (error) {
      console.error('Failed to load users:', error);
      message.error(t('settings.admin.users.loadFailed'));
    } finally {
      setLoading(false);
    }
  }, [message, t]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const isSelf = (target: IAdminUser): boolean => target.id === currentUser?.id;

  const handleProvision = async () => {
    let values: { username: string; password: string; role: AuthRole };
    try {
      values = (await provisionForm.validate()) as { username: string; password: string; role: AuthRole };
    } catch {
      // Validation failed — Arco Form highlights invalid fields automatically.
      return;
    }
    setProvisionLoading(true);
    try {
      await ipcBridge.admin.users.create.invoke({
        username: values.username.trim(),
        password: values.password,
        role: values.role,
      });
      message.success(t('settings.admin.users.provisionSuccess'));
      setProvisionVisible(false);
      provisionForm.resetFields();
      await refresh();
    } catch (error) {
      console.error('Failed to provision user:', error);
      message.error(t('settings.admin.users.provisionFailed'));
    } finally {
      setProvisionLoading(false);
    }
  };

  const handleSetRole = async (target: IAdminUser, role: AuthRole) => {
    try {
      await ipcBridge.admin.users.setRole.invoke({ id: target.id, role });
      message.success(t('settings.admin.users.roleChanged'));
      await refresh();
    } catch (error) {
      console.error('Failed to set role:', error);
      message.error(t('settings.admin.users.actionFailed'));
    }
  };

  const handleToggleDisabled = async (target: IAdminUser) => {
    try {
      if (target.disabled) {
        await ipcBridge.admin.users.enable.invoke({ id: target.id });
      } else {
        await ipcBridge.admin.users.disable.invoke({ id: target.id });
      }
      await refresh();
    } catch (error) {
      console.error('Failed to toggle user:', error);
      message.error(t('settings.admin.users.actionFailed'));
    }
  };

  const handleSetPassword = async () => {
    if (!passwordTarget) return;
    let values: { password: string };
    try {
      values = (await passwordForm.validate()) as { password: string };
    } catch {
      return;
    }
    setPasswordLoading(true);
    try {
      await ipcBridge.admin.users.setPassword.invoke({ id: passwordTarget.id, password: values.password });
      message.success(t('settings.admin.users.passwordChanged'));
      setPasswordTarget(null);
      passwordForm.resetFields();
    } catch (error) {
      console.error('Failed to set password:', error);
      message.error(t('settings.admin.users.actionFailed'));
    } finally {
      setPasswordLoading(false);
    }
  };

  return (
    <div className='flex flex-col gap-12px'>
      {messageContext}
      <div className='flex justify-end'>
        <Button
          type='primary'
          icon={<Plus theme='outline' size='14' />}
          onClick={() => {
            provisionForm.resetFields();
            setProvisionVisible(true);
          }}
        >
          {t('settings.admin.users.provision')}
        </Button>
      </div>

      <Table
        loading={loading}
        data={users}
        rowKey='id'
        pagination={false}
        border={false}
        columns={[
          {
            title: t('settings.admin.users.username'),
            dataIndex: 'username',
            render: (value: string) => <span className='text-t-primary font-500'>{value}</span>,
          },
          {
            title: t('settings.admin.users.role'),
            dataIndex: 'role',
            width: 120,
            render: (value: AuthRole) => (
              <Tag size='small' color={value === 'admin' ? 'purple' : 'gray'}>
                {value === 'admin' ? t('settings.admin.users.roleAdmin') : t('settings.admin.users.roleMember')}
              </Tag>
            ),
          },
          {
            title: t('settings.admin.users.status'),
            dataIndex: 'disabled',
            width: 120,
            render: (disabled: boolean | undefined) =>
              disabled ? (
                <Tag size='small' color='red'>
                  {t('settings.admin.users.disabled')}
                </Tag>
              ) : (
                <Tag size='small' color='green'>
                  {t('settings.admin.users.active')}
                </Tag>
              ),
          },
          {
            title: t('settings.admin.users.actions'),
            key: 'actions',
            width: 280,
            render: (_: unknown, record: IAdminUser) => {
              const self = isSelf(record);
              return (
                <div className='flex items-center gap-6px'>
                  {self ? (
                    <Tooltip content={t('settings.admin.users.cannotChangeSelf')}>
                      <Button size='mini' disabled style={{ width: 104 }}>
                        {record.role === 'admin'
                          ? t('settings.admin.users.roleAdmin')
                          : t('settings.admin.users.roleMember')}
                      </Button>
                    </Tooltip>
                  ) : (
                    <Select
                      size='mini'
                      style={{ width: 104 }}
                      value={record.role}
                      onChange={(role) => {
                        void handleSetRole(record, role as AuthRole);
                      }}
                    >
                      <Select.Option value='member'>{t('settings.admin.users.roleMember')}</Select.Option>
                      <Select.Option value='admin'>{t('settings.admin.users.roleAdmin')}</Select.Option>
                    </Select>
                  )}
                  {record.disabled ? (
                    <Tooltip content={t('settings.admin.users.enable')}>
                      <Button
                        size='mini'
                        icon={<Unlock theme='outline' size='14' />}
                        onClick={() => {
                          void handleToggleDisabled(record);
                        }}
                      />
                    </Tooltip>
                  ) : self ? (
                    <Tooltip content={t('settings.admin.users.cannotDisableSelf')}>
                      <Button size='mini' icon={<Block theme='outline' size='14' />} disabled />
                    </Tooltip>
                  ) : (
                    <Popconfirm
                      title={t('settings.admin.users.disableConfirm', { name: record.username })}
                      onOk={() => {
                        void handleToggleDisabled(record);
                      }}
                    >
                      <Tooltip content={t('settings.admin.users.disable')}>
                        <Button size='mini' icon={<Block theme='outline' size='14' />} />
                      </Tooltip>
                    </Popconfirm>
                  )}
                  <Tooltip content={t('settings.admin.users.setPassword')}>
                    <Button
                      size='mini'
                      icon={<User theme='outline' size='14' />}
                      onClick={() => {
                        passwordForm.resetFields();
                        setPasswordTarget(record);
                      }}
                    />
                  </Tooltip>
                </div>
              );
            },
          },
        ]}
      />

      {/* Provision user dialog */}
      <Modal
        title={t('settings.admin.users.provisionTitle')}
        visible={provisionVisible}
        confirmLoading={provisionLoading}
        onOk={() => {
          void handleProvision();
        }}
        onCancel={() => setProvisionVisible(false)}
        okText={t('common.confirm')}
        cancelText={t('common.cancel')}
        unmountOnExit
      >
        <Form form={provisionForm} layout='vertical'>
          <Form.Item label={t('settings.admin.users.username')} field='username' rules={[{ required: true }]}>
            <Input autoComplete='off' />
          </Form.Item>
          <Form.Item label={t('settings.admin.users.newPassword')} field='password' rules={[{ required: true }]}>
            <Input.Password autoComplete='new-password' visibilityToggle />
          </Form.Item>
          <Form.Item
            label={t('settings.admin.users.role')}
            field='role'
            initialValue='member'
            rules={[{ required: true }]}
          >
            <Select>
              <Select.Option value='member'>{t('settings.admin.users.roleMember')}</Select.Option>
              <Select.Option value='admin'>{t('settings.admin.users.roleAdmin')}</Select.Option>
            </Select>
          </Form.Item>
        </Form>
      </Modal>

      {/* Set password dialog */}
      <Modal
        title={t('settings.admin.users.setPasswordTitle', {
          name: passwordTarget?.username ?? '',
        })}
        visible={passwordTarget !== null}
        confirmLoading={passwordLoading}
        onOk={() => {
          void handleSetPassword();
        }}
        onCancel={() => setPasswordTarget(null)}
        okText={t('common.confirm')}
        cancelText={t('common.cancel')}
        unmountOnExit
      >
        <Form form={passwordForm} layout='vertical'>
          <Form.Item label={t('settings.admin.users.newPassword')} field='password' rules={[{ required: true }]}>
            <Input.Password autoComplete='new-password' visibilityToggle />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
};

export default UsersPanel;
