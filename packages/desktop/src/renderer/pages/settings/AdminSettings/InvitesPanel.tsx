/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { Button, Form, InputNumber, Message, Modal, Popconfirm, Table, Tag, Tooltip } from '@arco-design/web-react';
import { Copy, Plus, Delete } from '@icon-park/react';
import React, { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ipcBridge } from '@/common';
import { deriveInviteStatus, type IAdminInvite } from '@/common/types/auth';
import { copyText } from '@renderer/utils/ui/clipboard';
import { formatDateTime } from '@renderer/services/i18n/format';

/** Arco Tag color per derived invite status. */
const STATUS_TAG_COLOR: Record<string, string> = {
  active: 'green',
  used: 'gray',
  expired: 'orange',
  revoked: 'red',
};

/** Explicit i18n keys per derived invite status (static keys, checker-friendly). */
const STATUS_I18N_KEY: Record<string, string> = {
  active: 'settings.admin.invites.status.active',
  used: 'settings.admin.invites.status.used',
  expired: 'settings.admin.invites.status.expired',
  revoked: 'settings.admin.invites.status.revoked',
};

/**
 * Invites tab of the admin console: list invites, mint new ones (optionally
 * expiring), revoke. The plaintext code is returned by POST /api/admin/invites
 * EXACTLY ONCE — it is shown in a modal with a copy button and never persisted
 * client-side; the list only ever shows backend-provided masked hints.
 */
const InvitesPanel: React.FC = () => {
  const { t, i18n } = useTranslation();
  const [invites, setInvites] = useState<IAdminInvite[]>([]);
  const [loading, setLoading] = useState(false);
  const [createVisible, setCreateVisible] = useState(false);
  const [createLoading, setCreateLoading] = useState(false);
  /** Plaintext code from the most recent create — shown once, cleared on close. */
  const [issuedCode, setIssuedCode] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [form] = Form.useForm();
  const [message, messageContext] = Message.useMessage();

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const list = await ipcBridge.admin.invites.list.invoke();
      setInvites(list ?? []);
    } catch (error) {
      console.error('Failed to load invites:', error);
      message.error(t('settings.admin.invites.loadFailed'));
    } finally {
      setLoading(false);
    }
  }, [message, t]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const handleCreate = async () => {
    let values: { expiryHours?: number };
    try {
      values = (await form.validate()) as { expiryHours?: number };
    } catch {
      return;
    }
    setCreateLoading(true);
    try {
      const created = await ipcBridge.admin.invites.create.invoke(
        values.expiryHours && values.expiryHours > 0 ? { expires_in_hours: values.expiryHours } : {}
      );
      setCreateVisible(false);
      form.resetFields();
      if (created?.code) {
        setCopied(false);
        setIssuedCode(created.code);
      }
      await refresh();
    } catch (error) {
      console.error('Failed to create invite:', error);
      message.error(t('settings.admin.invites.createFailed'));
    } finally {
      setCreateLoading(false);
    }
  };

  const handleRevoke = async (invite: IAdminInvite) => {
    try {
      await ipcBridge.admin.invites.revoke.invoke({ id: invite.id });
      await refresh();
    } catch (error) {
      console.error('Failed to revoke invite:', error);
      message.error(t('settings.admin.invites.revokeFailed'));
    }
  };

  const handleCopy = async () => {
    if (!issuedCode) return;
    try {
      await copyText(issuedCode);
      setCopied(true);
    } catch (error) {
      console.error('Failed to copy invite code:', error);
      message.error(t('common.copyFailed'));
    }
  };

  const formatInstant = (value: string | number | null | undefined): string => {
    if (value === null || value === undefined || value === '') {
      return '—';
    }
    const ms = typeof value === 'number' ? value : Date.parse(value);
    if (Number.isNaN(ms)) {
      return String(value);
    }
    return formatDateTime(ms, i18n.language);
  };

  return (
    <div className='flex flex-col gap-12px'>
      {messageContext}
      <div className='flex items-center justify-between gap-8px'>
        <div className='text-12px text-t-tertiary'>{t('settings.admin.invites.hint')}</div>
        <Button
          type='primary'
          icon={<Plus theme='outline' size='14' />}
          onClick={() => {
            form.resetFields();
            setCreateVisible(true);
          }}
        >
          {t('settings.admin.invites.create')}
        </Button>
      </div>

      <Table
        loading={loading}
        data={invites}
        rowKey='id'
        pagination={false}
        border={false}
        columns={[
          {
            title: t('settings.admin.invites.code'),
            dataIndex: 'code',
            render: (value: string | undefined, record: IAdminInvite) => (
              <span className='font-mono text-t-secondary'>{value ?? record.id}</span>
            ),
          },
          {
            title: t('settings.admin.invites.statusLabel'),
            key: 'status',
            width: 110,
            render: (_: unknown, record: IAdminInvite) => {
              const status = deriveInviteStatus(record);
              return (
                <Tag size='small' color={STATUS_TAG_COLOR[status] ?? 'gray'}>
                  {t(STATUS_I18N_KEY[status] ?? 'settings.admin.invites.status.active')}
                </Tag>
              );
            },
          },
          {
            title: t('settings.admin.invites.createdAt'),
            dataIndex: 'created_at',
            width: 170,
            render: (value: string | number | undefined) => formatInstant(value ?? null),
          },
          {
            title: t('settings.admin.invites.expiresAt'),
            dataIndex: 'expires_at',
            width: 170,
            render: (value: string | number | undefined) => formatInstant(value ?? null),
          },
          {
            title: t('settings.admin.invites.usedAt'),
            dataIndex: 'used_at',
            width: 170,
            render: (value: string | number | undefined) => formatInstant(value ?? null),
          },
          {
            title: t('common.actions'),
            key: 'actions',
            width: 90,
            render: (_: unknown, record: IAdminInvite) => (
              <Popconfirm
                title={t('settings.admin.invites.revokeConfirm')}
                onOk={() => {
                  void handleRevoke(record);
                }}
              >
                <Tooltip content={t('settings.admin.invites.revoke')}>
                  <Button size='mini' status='danger' icon={<Delete theme='outline' size='14' />} />
                </Tooltip>
              </Popconfirm>
            ),
          },
        ]}
      />

      {/* Create invite dialog */}
      <Modal
        title={t('settings.admin.invites.createTitle')}
        visible={createVisible}
        confirmLoading={createLoading}
        onOk={() => {
          void handleCreate();
        }}
        onCancel={() => setCreateVisible(false)}
        okText={t('common.confirm')}
        cancelText={t('common.cancel')}
        unmountOnExit
      >
        <Form form={form} layout='vertical'>
          <Form.Item label={t('settings.admin.invites.expiryHours')} field='expiryHours'>
            <InputNumber min={1} max={24 * 365} placeholder={t('settings.admin.invites.expiryHint')} />
          </Form.Item>
        </Form>
      </Modal>

      {/* Issued-code modal — the ONLY time the plaintext code is shown */}
      <Modal
        title={t('settings.admin.invites.codeTitle')}
        visible={issuedCode !== null}
        footer={null}
        onCancel={() => setIssuedCode(null)}
        unmountOnExit
      >
        <div className='flex flex-col gap-12px'>
          <div className='text-13px text-warning leading-5'>{t('settings.admin.invites.codeWarning')}</div>
          <div className='flex items-center gap-8px'>
            <code className='flex-1 rd-8px px-12px py-8px bg-fill-2 text-14px font-mono break-all select-all'>
              {issuedCode}
            </code>
            <Button
              type='primary'
              size='small'
              icon={copied ? undefined : <Copy theme='outline' size='14' />}
              onClick={() => {
                void handleCopy();
              }}
            >
              {copied ? t('common.copied') : t('common.copy')}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
};

export default InvitesPanel;
