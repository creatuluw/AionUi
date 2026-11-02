/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { Button, Form, Input, Message } from '@arco-design/web-react';
import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate } from 'react-router-dom';
import AppLoader from '@renderer/components/layout/AppLoader';
import LanguageSwitcher from '@renderer/components/settings/LanguageSwitcher';
import { useAuth } from '@renderer/hooks/context/AuthContext';
import loginLogo from '@renderer/assets/logos/brand/app.png';
import './RegisterPage.css';

type RegisterFormValues = {
  code: string;
  username: string;
  password: string;
  confirmPassword: string;
};

/**
 * Invite-redemption signup page (WebUI multi-user mode).
 *
 * Posts /api/auth/register through the ipcBridge HTTP route; the backend sets
 * the session cookies on success, so we reuse the AuthContext bootstrap and
 * land the fresh member straight in the app. Desktop builds have no such
 * backend contract exposed — the page is reachable in web mode only.
 */
const RegisterPage: React.FC = () => {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const { status, register } = useAuth();
  const [form] = Form.useForm();
  const [loading, setLoading] = useState(false);
  const [message, messageContext] = Message.useMessage();

  useEffect(() => {
    document.body.classList.add('login-page-active');
    return () => {
      document.body.classList.remove('login-page-active');
    };
  }, []);

  useEffect(() => {
    document.documentElement.lang = i18n.language;
  }, [i18n.language]);

  useEffect(() => {
    if (status === 'authenticated') {
      void navigate('/guid', { replace: true });
    }
  }, [navigate, status]);

  const handleSubmit = async (values: RegisterFormValues) => {
    setLoading(true);
    const result = await register({
      code: values.code,
      username: values.username,
      password: values.password,
    });

    if (result.success) {
      message.success(t('login.register.success'));
      window.setTimeout(() => {
        void navigate('/guid', { replace: true });
      }, 600);
    } else {
      const errorText = (() => {
        switch (result.code) {
          case 'invalidCode':
            return t('login.register.errors.invalidCode');
          case 'expiredCode':
            return t('login.register.errors.expiredCode');
          case 'usernameTaken':
            return t('login.register.errors.usernameTaken');
          case 'weakPassword':
            return t('login.register.errors.weakPassword');
          case 'rateLimited':
            return t('login.register.errors.rateLimited');
          case 'serverError':
            return t('login.register.errors.serverError');
          case 'networkError':
            return t('login.register.errors.networkError');
          case 'unknown':
          default:
            return result.message || t('login.register.errors.unknown');
        }
      })();
      message.error(errorText);
      setLoading(false);
    }
  };

  if (status === 'checking') {
    return <AppLoader />;
  }

  return (
    <div className='login-page'>
      <div className='login-page__card register-page__card'>
        {messageContext}
        <div className='login-page__lang-select-wrapper'>
          <LanguageSwitcher />
        </div>

        <div className='login-page__header'>
          <div className='login-page__logo'>
            <img src={loginLogo} alt={t('login.brand')} />
          </div>
          <h1 className='login-page__title'>{t('login.brand')}</h1>
          <p className='login-page__subtitle'>{t('login.register.subtitle')}</p>
        </div>

        <Form
          form={form}
          layout='vertical'
          className='register-page__form'
          onSubmit={(values) => {
            void handleSubmit(values as RegisterFormValues);
          }}
        >
          <Form.Item
            label={t('login.register.inviteCode')}
            field='code'
            required
            rules={[{ required: true, message: t('login.register.errors.codeRequired') }]}
          >
            <Input allowClear placeholder={t('login.register.inviteCodePlaceholder')} autoComplete='off' />
          </Form.Item>

          <Form.Item
            label={t('login.username')}
            field='username'
            required
            rules={[{ required: true, message: t('login.register.errors.usernameRequired') }]}
          >
            <Input allowClear placeholder={t('login.usernamePlaceholder')} autoComplete='username' />
          </Form.Item>

          <Form.Item
            label={t('login.password')}
            field='password'
            required
            rules={[{ required: true, message: t('login.register.errors.passwordRequired') }]}
          >
            <Input.Password placeholder={t('login.passwordPlaceholder')} autoComplete='new-password' visibilityToggle />
          </Form.Item>

          <Form.Item
            label={t('login.register.confirmPassword')}
            field='confirmPassword'
            required
            rules={[
              { required: true, message: t('login.register.errors.confirmRequired') },
              {
                validator: (value: string | undefined, callback: (error?: string) => void) => {
                  const password = form.getFieldValue('password') as string | undefined;
                  if (!value || value === password) {
                    callback();
                    return;
                  }
                  callback(t('login.register.errors.passwordMismatch'));
                },
              },
            ]}
          >
            <Input.Password placeholder={t('login.register.confirmPassword')} autoComplete='new-password' visibilityToggle />
          </Form.Item>

          <Button
            type='primary'
            htmlType='submit'
            long
            loading={loading}
            className='register-page__submit'
          >
            {loading ? t('login.register.submitting') : t('login.register.submit')}
          </Button>
        </Form>

        <div className='register-page__signin-link'>
          <Link to='/login'>{t('login.register.backToLogin')}</Link>
        </div>

        <div className='login-page__footer'>
          <div className='login-page__footer-content'>
            <span>{t('login.footerPrimary')}</span>
            <span className='login-page__footer-divider'>•</span>
            <span>{t('login.footerSecondary')}</span>
          </div>
        </div>
      </div>
    </div>
  );
};

export default RegisterPage;
