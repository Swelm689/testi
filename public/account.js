import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';

const AUTH_CONFIG_ENDPOINT = '/api/auth-config';
const ACCOUNT_ENDPOINT = '/api/account';
const MIGRATION_MARKER_KEY = 'nano_account_migration';
const SESSION_BACKUP_KEY = 'nano_supabase_session_backup_v1';
const SESSION_RESUME_PROBE_MS = 45 * 1000;

const COPY = {
  en: {
    profile_menu: 'Profile',
    profile_switch: 'Switch account',
    profile_menu_button: 'Account menu',
    auth_kicker: 'Private Studio',
    auth_title: 'Continue with Google',
    auth_body: 'Sign in once to open your account, keep your history, and sync your presets.',
    auth_button: 'Continue with Google',
    auth_aside_label: 'What your account keeps',
    auth_benefit_history: 'Generation history per account',
    auth_benefit_presets: 'Title and characteristic presets',
    auth_benefit_inspiration: 'Design inspiration presets and images',
    auth_status_checking: 'Checking your session...',
    auth_status_idle: 'Sign in or register with Google to continue.',
    auth_status_signing_in: 'Redirecting to Google...',
    auth_status_switching: 'Switching account...',
    auth_status_loading: 'Opening your account...',
    auth_status_migrating: 'Linking your current browser data to this account...',
    auth_status_missing_config: 'Supabase is not configured yet. Add the required Supabase environment variables in Vercel.',
    auth_status_failed: 'Could not open your account. Please try again.',
    auth_status_signed_out: 'Signed out. Sign in with Google to continue.',
    migration_pill: 'Existing local data found',
    migration_title: 'Register to keep your current history',
    migration_body: 'The first Google account you use here will receive the history and presets currently stored in this browser. After migration, they will be removed from local storage so another account cannot inherit them.',
    migration_button: 'Continue with Google',
    migration_running_button: 'Linking current browser data...',
    profile_back: 'Back',
    profile_kicker: 'Account',
    profile_title: 'Profile',
    profile_signout: 'Sign out',
    profile_history_label: 'History items',
    profile_preset_label: 'Text presets',
    profile_inspiration_label: 'Inspiration presets',
    profile_future_credits_label: 'Credits',
    profile_future_credits_body: 'Reserved for future credit balance and usage controls.',
    profile_future_subscription_label: 'Subscription',
    profile_future_subscription_body: 'Reserved for future subscription and billing controls.',
    profile_created_prefix: 'Created',
    profile_migration_done: 'Local browser data linked to this account',
    profile_migration_none: 'No local migration recorded',
  },
  ru: {
    profile_menu: 'Профиль',
    profile_switch: 'Сменить аккаунт',
    profile_menu_button: 'Меню аккаунта',
    auth_kicker: 'Приватная студия',
    auth_title: 'Продолжить через Google',
    auth_body: 'Войдите один раз, чтобы открыть свой аккаунт, сохранить историю и синхронизировать пресеты.',
    auth_button: 'Продолжить через Google',
    auth_aside_label: 'Что хранит аккаунт',
    auth_benefit_history: 'История генераций для каждого аккаунта',
    auth_benefit_presets: 'Пресеты заголовков и характеристик',
    auth_benefit_inspiration: 'Пресеты дизайна и изображения вдохновения',
    auth_status_checking: 'Проверяем сессию...',
    auth_status_idle: 'Войдите или зарегистрируйтесь через Google, чтобы продолжить.',
    auth_status_signing_in: 'Перенаправляем в Google...',
    auth_status_switching: 'Переключаем аккаунт...',
    auth_status_loading: 'Открываем ваш аккаунт...',
    auth_status_migrating: 'Привязываем текущие данные браузера к этому аккаунту...',
    auth_status_missing_config: 'Supabase пока не настроен. Добавьте обязательные переменные окружения Supabase в Vercel.',
    auth_status_failed: 'Не удалось открыть аккаунт. Попробуйте снова.',
    auth_status_signed_out: 'Вы вышли из аккаунта. Войдите через Google, чтобы продолжить.',
    migration_pill: 'Найдены локальные данные',
    migration_title: 'Зарегистрируйтесь, чтобы сохранить текущую историю',
    migration_body: 'Первый аккаунт Google, который вы используете здесь, получит историю и пресеты из этого браузера. После миграции они будут удалены из локального хранилища, чтобы другой аккаунт не смог их унаследовать.',
    migration_button: 'Продолжить через Google',
    migration_running_button: 'Привязываем текущие данные браузера...',
    profile_back: 'Назад',
    profile_kicker: 'Аккаунт',
    profile_title: 'Профиль',
    profile_signout: 'Выйти',
    profile_history_label: 'Элементы истории',
    profile_preset_label: 'Текстовые пресеты',
    profile_inspiration_label: 'Пресеты вдохновения',
    profile_future_credits_label: 'Кредиты',
    profile_future_credits_body: 'Зарезервировано для будущего баланса кредитов и управления расходом.',
    profile_future_subscription_label: 'Подписка',
    profile_future_subscription_body: 'Зарезервировано для будущих настроек подписки и биллинга.',
    profile_created_prefix: 'Создан',
    profile_migration_done: 'Локальные данные браузера привязаны к этому аккаунту',
    profile_migration_none: 'Локальная миграция не зафиксирована',
  },
};

COPY.es = {
  profile_menu: 'Perfil',
  profile_switch: 'Cambiar cuenta',
  profile_menu_button: 'Menú de cuenta',
  auth_kicker: 'Estudio privado',
  auth_title: 'Continuar con Google',
  auth_body: 'Inicia sesión una vez para abrir tu cuenta, conservar tu historial y sincronizar tus preajustes.',
  auth_button: 'Continuar con Google',
  auth_aside_label: 'Lo que guarda tu cuenta',
  auth_benefit_history: 'Historial de generaciones por cuenta',
  auth_benefit_presets: 'Preajustes de títulos y características',
  auth_benefit_inspiration: 'Preajustes e imágenes de inspiración de diseño',
  auth_status_checking: 'Comprobando tu sesión...',
  auth_status_idle: 'Inicia sesión o regístrate con Google para continuar.',
  auth_status_signing_in: 'Redirigiendo a Google...',
  auth_status_switching: 'Cambiando de cuenta...',
  auth_status_loading: 'Abriendo tu cuenta...',
  auth_status_migrating: 'Vinculando los datos actuales de este navegador a esta cuenta...',
  auth_status_missing_config: 'Supabase aún no está configurado. Agrega las variables de entorno requeridas de Supabase en Vercel.',
  auth_status_failed: 'No se pudo abrir tu cuenta. Inténtalo de nuevo.',
  auth_status_signed_out: 'Sesión cerrada. Inicia sesión con Google para continuar.',
  migration_pill: 'Se encontraron datos locales',
  migration_title: 'Regístrate para conservar tu historial actual',
  migration_body: 'La primera cuenta de Google que uses aquí recibirá el historial y los preajustes almacenados actualmente en este navegador. Después de la migración, se eliminarán del almacenamiento local para que otra cuenta no pueda heredarlos.',
  migration_button: 'Continuar con Google',
  migration_running_button: 'Vinculando los datos actuales del navegador...',
  profile_back: 'Volver',
  profile_kicker: 'Cuenta',
  profile_title: 'Perfil',
  profile_signout: 'Cerrar sesión',
  profile_history_label: 'Elementos del historial',
  profile_preset_label: 'Preajustes de texto',
  profile_inspiration_label: 'Preajustes de inspiración',
  profile_future_credits_label: 'Créditos',
  profile_future_credits_body: 'Reservado para futuros controles de saldo y uso de créditos.',
  profile_future_subscription_label: 'Suscripción',
  profile_future_subscription_body: 'Reservado para futuros controles de suscripción y facturación.',
  profile_created_prefix: 'Creada',
  profile_migration_done: 'Los datos locales del navegador se vincularon a esta cuenta',
  profile_migration_none: 'No hay migración local registrada',
};

COPY.zh = {
  profile_menu: '个人资料',
  profile_switch: '切换账号',
  profile_menu_button: '账号菜单',
  auth_kicker: '私人工作室',
  auth_title: '使用 Google 继续',
  auth_body: '登录一次即可打开你的账号、保留历史记录并同步预设。',
  auth_button: '使用 Google 继续',
  auth_aside_label: '你的账号会保存',
  auth_benefit_history: '按账号保存生成历史',
  auth_benefit_presets: '标题和特征预设',
  auth_benefit_inspiration: '设计灵感预设和图片',
  auth_status_checking: '正在检查你的会话...',
  auth_status_idle: '请使用 Google 登录或注册后继续。',
  auth_status_signing_in: '正在跳转到 Google...',
  auth_status_switching: '正在切换账号...',
  auth_status_loading: '正在打开你的账号...',
  auth_status_migrating: '正在将当前浏览器数据关联到此账号...',
  auth_status_missing_config: 'Supabase 尚未配置。请在 Vercel 中添加必需的 Supabase 环境变量。',
  auth_status_failed: '无法打开你的账号。请重试。',
  auth_status_signed_out: '已退出登录。请使用 Google 登录后继续。',
  migration_pill: '发现本地数据',
  migration_title: '注册以保留你当前的历史记录',
  migration_body: '你在这里使用的第一个 Google 账号将接收当前保存在此浏览器中的历史记录和预设。迁移完成后，这些数据会从本地存储中删除，避免被其他账号继承。',
  migration_button: '使用 Google 继续',
  migration_running_button: '正在关联当前浏览器数据...',
  profile_back: '返回',
  profile_kicker: '账号',
  profile_title: '个人资料',
  profile_signout: '退出登录',
  profile_history_label: '历史记录项',
  profile_preset_label: '文本预设',
  profile_inspiration_label: '灵感预设',
  profile_future_credits_label: '积分',
  profile_future_credits_body: '为未来的积分余额和用量控制预留。',
  profile_future_subscription_label: '订阅',
  profile_future_subscription_body: '为未来的订阅和计费控制预留。',
  profile_created_prefix: '创建于',
  profile_migration_done: '本地浏览器数据已关联到此账号',
  profile_migration_none: '没有记录到本地迁移',
};

COPY.ar = {
  profile_menu: 'الملف الشخصي',
  profile_switch: 'تبديل الحساب',
  profile_menu_button: 'قائمة الحساب',
  auth_kicker: 'استوديو خاص',
  auth_title: 'المتابعة باستخدام Google',
  auth_body: 'سجّل الدخول مرة واحدة لفتح حسابك والاحتفاظ بسجلك ومزامنة الإعدادات المسبقة.',
  auth_button: 'المتابعة باستخدام Google',
  auth_aside_label: 'ما الذي يحتفظ به حسابك',
  auth_benefit_history: 'سجل الإنشاءات لكل حساب',
  auth_benefit_presets: 'إعدادات العنوان والخصائص',
  auth_benefit_inspiration: 'إعدادات وصور إلهام التصميم',
  auth_status_checking: 'جارٍ التحقق من جلستك...',
  auth_status_idle: 'سجّل الدخول أو أنشئ حساباً عبر Google للمتابعة.',
  auth_status_signing_in: 'جارٍ التحويل إلى Google...',
  auth_status_switching: 'جارٍ تبديل الحساب...',
  auth_status_loading: 'جارٍ فتح حسابك...',
  auth_status_migrating: 'جارٍ ربط بيانات المتصفح الحالية بهذا الحساب...',
  auth_status_missing_config: 'لم يتم إعداد Supabase بعد. أضف متغيرات بيئة Supabase المطلوبة في Vercel.',
  auth_status_failed: 'تعذر فتح حسابك. حاول مرة أخرى.',
  auth_status_signed_out: 'تم تسجيل الخروج. سجّل الدخول باستخدام Google للمتابعة.',
  migration_pill: 'تم العثور على بيانات محلية',
  migration_title: 'سجّل للحفاظ على سجلك الحالي',
  migration_body: 'أول حساب Google تستخدمه هنا سيستلم السجل والإعدادات المسبقة المخزنة حالياً في هذا المتصفح. بعد الترحيل ستتم إزالتها من التخزين المحلي حتى لا يرثها حساب آخر.',
  migration_button: 'المتابعة باستخدام Google',
  migration_running_button: 'جارٍ ربط بيانات المتصفح الحالية...',
  profile_back: 'رجوع',
  profile_kicker: 'الحساب',
  profile_title: 'الملف الشخصي',
  profile_signout: 'تسجيل الخروج',
  profile_history_label: 'عناصر السجل',
  profile_preset_label: 'الإعدادات النصية',
  profile_inspiration_label: 'إعدادات الإلهام',
  profile_future_credits_label: 'الأرصدة',
  profile_future_credits_body: 'محجوزة مستقبلاً لرصيد الأرصدة وعناصر التحكم في الاستخدام.',
  profile_future_subscription_label: 'الاشتراك',
  profile_future_subscription_body: 'محجوزة مستقبلاً لعناصر التحكم في الاشتراك والفوترة.',
  profile_created_prefix: 'تم الإنشاء',
  profile_migration_done: 'تم ربط بيانات المتصفح المحلية بهذا الحساب',
  profile_migration_none: 'لا توجد عملية ترحيل محلية مسجلة',
};

COPY.fr = {
  profile_menu: 'Profil',
  profile_switch: 'Changer de compte',
  profile_menu_button: 'Menu du compte',
  auth_kicker: 'Studio privé',
  auth_title: 'Continuer avec Google',
  auth_body: 'Connectez-vous une fois pour ouvrir votre compte, conserver votre historique et synchroniser vos préréglages.',
  auth_button: 'Continuer avec Google',
  auth_aside_label: 'Ce que votre compte conserve',
  auth_benefit_history: 'Historique des générations par compte',
  auth_benefit_presets: 'Préréglages de titre et de caractéristiques',
  auth_benefit_inspiration: 'Préréglages et images d’inspiration design',
  auth_status_checking: 'Vérification de votre session...',
  auth_status_idle: 'Connectez-vous ou inscrivez-vous avec Google pour continuer.',
  auth_status_signing_in: 'Redirection vers Google...',
  auth_status_switching: 'Changement de compte...',
  auth_status_loading: 'Ouverture de votre compte...',
  auth_status_migrating: 'Association des données actuelles de ce navigateur à ce compte...',
  auth_status_missing_config: 'Supabase n’est pas encore configuré. Ajoutez les variables d’environnement Supabase requises dans Vercel.',
  auth_status_failed: 'Impossible d’ouvrir votre compte. Réessayez.',
  auth_status_signed_out: 'Déconnecté. Connectez-vous avec Google pour continuer.',
  migration_pill: 'Données locales détectées',
  migration_title: 'Inscrivez-vous pour conserver votre historique actuel',
  migration_body: 'Le premier compte Google que vous utilisez ici recevra l’historique et les préréglages actuellement stockés dans ce navigateur. Après la migration, ils seront supprimés du stockage local afin qu’un autre compte ne puisse pas les hériter.',
  migration_button: 'Continuer avec Google',
  migration_running_button: 'Association des données actuelles du navigateur...',
  profile_back: 'Retour',
  profile_kicker: 'Compte',
  profile_title: 'Profil',
  profile_signout: 'Se déconnecter',
  profile_history_label: 'Éléments d’historique',
  profile_preset_label: 'Préréglages texte',
  profile_inspiration_label: 'Préréglages d’inspiration',
  profile_future_credits_label: 'Crédits',
  profile_future_credits_body: 'Réservé aux futurs contrôles du solde de crédits et de l’utilisation.',
  profile_future_subscription_label: 'Abonnement',
  profile_future_subscription_body: 'Réservé aux futurs contrôles d’abonnement et de facturation.',
  profile_created_prefix: 'Créé',
  profile_migration_done: 'Les données locales du navigateur sont liées à ce compte',
  profile_migration_none: 'Aucune migration locale enregistrée',
};

COPY.pt = {
  profile_menu: 'Perfil',
  profile_switch: 'Trocar conta',
  profile_menu_button: 'Menu da conta',
  auth_kicker: 'Estúdio privado',
  auth_title: 'Continuar com o Google',
  auth_body: 'Entre uma vez para abrir sua conta, manter seu histórico e sincronizar seus presets.',
  auth_button: 'Continuar com o Google',
  auth_aside_label: 'O que sua conta guarda',
  auth_benefit_history: 'Histórico de gerações por conta',
  auth_benefit_presets: 'Presets de título e características',
  auth_benefit_inspiration: 'Presets e imagens de inspiração de design',
  auth_status_checking: 'Verificando sua sessão...',
  auth_status_idle: 'Entre ou registre-se com o Google para continuar.',
  auth_status_signing_in: 'Redirecionando para o Google...',
  auth_status_switching: 'Trocando de conta...',
  auth_status_loading: 'Abrindo sua conta...',
  auth_status_migrating: 'Vinculando os dados atuais do navegador a esta conta...',
  auth_status_missing_config: 'O Supabase ainda não está configurado. Adicione as variáveis de ambiente necessárias do Supabase na Vercel.',
  auth_status_failed: 'Não foi possível abrir sua conta. Tente novamente.',
  auth_status_signed_out: 'Sessão encerrada. Entre com o Google para continuar.',
  migration_pill: 'Dados locais encontrados',
  migration_title: 'Registre-se para manter seu histórico atual',
  migration_body: 'A primeira conta do Google que você usar aqui receberá o histórico e os presets armazenados atualmente neste navegador. Após a migração, eles serão removidos do armazenamento local para que outra conta não possa herdá-los.',
  migration_button: 'Continuar com o Google',
  migration_running_button: 'Vinculando os dados atuais do navegador...',
  profile_back: 'Voltar',
  profile_kicker: 'Conta',
  profile_title: 'Perfil',
  profile_signout: 'Sair',
  profile_history_label: 'Itens do histórico',
  profile_preset_label: 'Presets de texto',
  profile_inspiration_label: 'Presets de inspiração',
  profile_future_credits_label: 'Créditos',
  profile_future_credits_body: 'Reservado para futuros controles de saldo de créditos e uso.',
  profile_future_subscription_label: 'Assinatura',
  profile_future_subscription_body: 'Reservado para futuros controles de assinatura e cobrança.',
  profile_created_prefix: 'Criada',
  profile_migration_done: 'Os dados locais do navegador foram vinculados a esta conta',
  profile_migration_none: 'Nenhuma migração local registrada',
};

COPY.de = {
  profile_menu: 'Profil',
  profile_switch: 'Konto wechseln',
  profile_menu_button: 'Kontomenü',
  auth_kicker: 'Privates Studio',
  auth_title: 'Mit Google fortfahren',
  auth_body: 'Melde dich einmal an, um dein Konto zu öffnen, deinen Verlauf zu behalten und deine Presets zu synchronisieren.',
  auth_button: 'Mit Google fortfahren',
  auth_aside_label: 'Was dein Konto speichert',
  auth_benefit_history: 'Generierungsverlauf pro Konto',
  auth_benefit_presets: 'Titel- und Eigenschafts-Presets',
  auth_benefit_inspiration: 'Design-Inspirations-Presets und Bilder',
  auth_status_checking: 'Deine Sitzung wird geprüft...',
  auth_status_idle: 'Melde dich an oder registriere dich mit Google, um fortzufahren.',
  auth_status_signing_in: 'Weiterleitung zu Google...',
  auth_status_switching: 'Konto wird gewechselt...',
  auth_status_loading: 'Dein Konto wird geöffnet...',
  auth_status_migrating: 'Aktuelle Browserdaten werden mit diesem Konto verknüpft...',
  auth_status_missing_config: 'Supabase ist noch nicht konfiguriert. Füge die erforderlichen Supabase-Umgebungsvariablen in Vercel hinzu.',
  auth_status_failed: 'Dein Konto konnte nicht geöffnet werden. Bitte versuche es erneut.',
  auth_status_signed_out: 'Abgemeldet. Melde dich mit Google an, um fortzufahren.',
  migration_pill: 'Lokale Daten gefunden',
  migration_title: 'Registriere dich, um deinen aktuellen Verlauf zu behalten',
  migration_body: 'Das erste Google-Konto, das du hier verwendest, erhält den Verlauf und die Presets, die aktuell in diesem Browser gespeichert sind. Nach der Migration werden sie aus dem lokalen Speicher entfernt, damit kein anderes Konto sie übernehmen kann.',
  migration_button: 'Mit Google fortfahren',
  migration_running_button: 'Aktuelle Browserdaten werden verknüpft...',
  profile_back: 'Zurück',
  profile_kicker: 'Konto',
  profile_title: 'Profil',
  profile_signout: 'Abmelden',
  profile_history_label: 'Verlaufseinträge',
  profile_preset_label: 'Text-Presets',
  profile_inspiration_label: 'Inspirations-Presets',
  profile_future_credits_label: 'Credits',
  profile_future_credits_body: 'Reserviert für zukünftige Guthaben- und Nutzungssteuerung.',
  profile_future_subscription_label: 'Abonnement',
  profile_future_subscription_body: 'Reserviert für zukünftige Abo- und Abrechnungssteuerung.',
  profile_created_prefix: 'Erstellt',
  profile_migration_done: 'Lokale Browserdaten wurden mit diesem Konto verknüpft',
  profile_migration_none: 'Keine lokale Migration erfasst',
};

COPY.ja = {
  profile_menu: 'プロフィール',
  profile_switch: 'アカウントを切り替え',
  profile_menu_button: 'アカウントメニュー',
  auth_kicker: 'プライベートスタジオ',
  auth_title: 'Google で続行',
  auth_body: '一度ログインすると、アカウントを開き、履歴を保持し、プリセットを同期できます。',
  auth_button: 'Google で続行',
  auth_aside_label: 'アカウントに保存される内容',
  auth_benefit_history: 'アカウントごとの生成履歴',
  auth_benefit_presets: 'タイトルと特性のプリセット',
  auth_benefit_inspiration: 'デザインインスピレーションのプリセットと画像',
  auth_status_checking: 'セッションを確認しています...',
  auth_status_idle: '続行するには Google でログインまたは登録してください。',
  auth_status_signing_in: 'Google にリダイレクトしています...',
  auth_status_switching: 'アカウントを切り替えています...',
  auth_status_loading: 'アカウントを開いています...',
  auth_status_migrating: '現在のブラウザデータをこのアカウントに関連付けています...',
  auth_status_missing_config: 'Supabase がまだ設定されていません。Vercel に必要な Supabase 環境変数を追加してください。',
  auth_status_failed: 'アカウントを開けませんでした。もう一度お試しください。',
  auth_status_signed_out: 'サインアウトしました。続行するには Google でログインしてください。',
  migration_pill: '既存のローカルデータが見つかりました',
  migration_title: '現在の履歴を保持するには登録してください',
  migration_body: 'ここで最初に使用した Google アカウントに、このブラウザに現在保存されている履歴とプリセットが引き継がれます。移行後、それらはローカルストレージから削除され、別のアカウントに引き継がれないようになります。',
  migration_button: 'Google で続行',
  migration_running_button: '現在のブラウザデータを関連付けています...',
  profile_back: '戻る',
  profile_kicker: 'アカウント',
  profile_title: 'プロフィール',
  profile_signout: 'サインアウト',
  profile_history_label: '履歴アイテム',
  profile_preset_label: 'テキストプリセット',
  profile_inspiration_label: 'インスピレーションプリセット',
  profile_future_credits_label: 'クレジット',
  profile_future_credits_body: '将来のクレジット残高と使用量管理のために予約されています。',
  profile_future_subscription_label: 'サブスクリプション',
  profile_future_subscription_body: '将来のサブスクリプションと請求管理のために予約されています。',
  profile_created_prefix: '作成日',
  profile_migration_done: 'ローカルブラウザデータがこのアカウントに関連付けられました',
  profile_migration_none: 'ローカル移行は記録されていません',
};

COPY.ko = {
  profile_menu: '프로필',
  profile_switch: '계정 전환',
  profile_menu_button: '계정 메뉴',
  auth_kicker: '프라이빗 스튜디오',
  auth_title: 'Google로 계속',
  auth_body: '한 번 로그인하면 계정을 열고, 기록을 유지하고, 프리셋을 동기화할 수 있습니다.',
  auth_button: 'Google로 계속',
  auth_aside_label: '계정에 저장되는 항목',
  auth_benefit_history: '계정별 생성 기록',
  auth_benefit_presets: '제목 및 특성 프리셋',
  auth_benefit_inspiration: '디자인 영감 프리셋 및 이미지',
  auth_status_checking: '세션을 확인하는 중...',
  auth_status_idle: '계속하려면 Google로 로그인하거나 가입하세요.',
  auth_status_signing_in: 'Google로 이동하는 중...',
  auth_status_switching: '계정을 전환하는 중...',
  auth_status_loading: '계정을 여는 중...',
  auth_status_migrating: '현재 브라우저 데이터를 이 계정에 연결하는 중...',
  auth_status_missing_config: 'Supabase가 아직 설정되지 않았습니다. Vercel에 필요한 Supabase 환경 변수를 추가하세요.',
  auth_status_failed: '계정을 열 수 없습니다. 다시 시도하세요.',
  auth_status_signed_out: '로그아웃되었습니다. 계속하려면 Google로 로그인하세요.',
  migration_pill: '기존 로컬 데이터를 찾았습니다',
  migration_title: '현재 기록을 유지하려면 가입하세요',
  migration_body: '여기서 처음 사용하는 Google 계정이 현재 이 브라우저에 저장된 기록과 프리셋을 받게 됩니다. 마이그레이션 후에는 다른 계정이 이를 이어받지 못하도록 로컬 저장소에서 제거됩니다.',
  migration_button: 'Google로 계속',
  migration_running_button: '현재 브라우저 데이터를 연결하는 중...',
  profile_back: '뒤로',
  profile_kicker: '계정',
  profile_title: '프로필',
  profile_signout: '로그아웃',
  profile_history_label: '기록 항목',
  profile_preset_label: '텍스트 프리셋',
  profile_inspiration_label: '영감 프리셋',
  profile_future_credits_label: '크레딧',
  profile_future_credits_body: '향후 크레딧 잔액 및 사용량 제어를 위해 예약됨.',
  profile_future_subscription_label: '구독',
  profile_future_subscription_body: '향후 구독 및 청구 제어를 위해 예약됨.',
  profile_created_prefix: '생성됨',
  profile_migration_done: '로컬 브라우저 데이터가 이 계정에 연결되었습니다',
  profile_migration_none: '기록된 로컬 마이그레이션이 없습니다',
};

const ACCOUNT_HISTORY_PAGE_SIZE = 16;

const state = {
  configured: false,
  client: null,
  session: null,
  user: null,
  profile: null,
  summary: null,
  legacyPayload: null,
  legacyPending: false,
  legacyScanComplete: false,
  authResolved: false,
  bootstrapComplete: false,
  authBusy: false,
  authStatusKey: 'auth_status_checking',
  authStatusTone: '',
  hadAuthenticatedSession: false,
  bootNonce: 0,
  historyHydrationNonce: 0,
  migrationRunning: false,
  accountSwitching: false,
  signOutPending: false,
  lastSessionProbeAt: 0,
};

const syncState = {
  textTimer: null,
  designTimer: null,
  historyTimer: null,
  historyQueue: [],
  historyDeleting: new Set(),
};

function qs(id) {
  return document.getElementById(id);
}

function getLang() {
  return window.I18N && window.I18N.lang ? window.I18N.lang : 'en';
}

function tr(key) {
  const lang = getLang();
  const bundle = COPY[lang] || COPY.en;
  return bundle[key] || COPY.en[key] || key;
}

function setText(id, value) {
  const el = qs(id);
  if (el) el.textContent = value;
}

function refreshIcons() {
  if (window.lucide && typeof window.lucide.createIcons === 'function') {
    requestAnimationFrame(() => window.lucide.createIcons());
  }
}

function readMigrationMarker() {
  try {
    const raw = localStorage.getItem(MIGRATION_MARKER_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch (_) {
    return null;
  }
}

function readStoredSessionBackup() {
  try {
    const raw = localStorage.getItem(SESSION_BACKUP_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch (_) {
    return null;
  }
}

function hasStoredSessionBackup() {
  const backup = readStoredSessionBackup();
  return !!(backup && backup.access_token && backup.refresh_token);
}

function persistSessionBackup(session) {
  if (!session || !session.access_token || !session.refresh_token) return;
  try {
    localStorage.setItem(SESSION_BACKUP_KEY, JSON.stringify({
      access_token: session.access_token,
      refresh_token: session.refresh_token,
      expires_at: session.expires_at || null,
      expires_in: session.expires_in || null,
      token_type: session.token_type || 'bearer',
      user_id: session.user && session.user.id ? session.user.id : null,
      saved_at: Date.now(),
    }));
  } catch (_) {
  }
}

function clearSessionBackup() {
  try {
    localStorage.removeItem(SESSION_BACKUP_KEY);
  } catch (_) {
  }
}

function getDisplayName() {
  return (state.profile && state.profile.display_name)
    || (state.user && state.user.user_metadata && (state.user.user_metadata.full_name || state.user.user_metadata.name))
    || (state.user && state.user.email)
    || 'Guest';
}

function getAvatarUrl() {
  return (state.profile && state.profile.avatar_url)
    || (state.user && state.user.user_metadata && state.user.user_metadata.avatar_url)
    || '';
}

function getInitials(name) {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return 'N';
  return parts.slice(0, 2).map((part) => part[0]).join('').toUpperCase();
}

function paintAvatar(el, name, avatarUrl) {
  if (!el) return;
  const initials = getInitials(name);
  el.textContent = initials;
  if (avatarUrl) {
    el.style.backgroundImage = `url(${avatarUrl})`;
  } else {
    el.style.backgroundImage = '';
  }
}

function showSessionCheckOverlay(visible) {
  const overlay = qs('sessionCheckOverlay');
  if (!overlay) return;
  overlay.classList.toggle('is-active', !!visible);
}

function isAuthLoadingMode() {
  return !!state.authBusy && ['auth_status_checking', 'auth_status_loading', 'auth_status_signing_in', 'auth_status_switching'].includes(state.authStatusKey);
}

function syncAuthGateVisualState() {
  const gate = qs('authGate');
  if (gate) {
    gate.classList.toggle('is-busy', !!state.authBusy);
    gate.classList.toggle('is-loading-mode', isAuthLoadingMode());
    gate.setAttribute('aria-busy', state.authBusy ? 'true' : 'false');
  }
  const loader = qs('authLoader');
  if (loader) loader.setAttribute('aria-hidden', isAuthLoadingMode() ? 'false' : 'true');
  const authButton = qs('authGoogleBtn');
  if (authButton) authButton.setAttribute('aria-busy', isAuthLoadingMode() ? 'true' : 'false');
  setText('authTitle', isAuthLoadingMode() ? tr(state.authStatusKey) : tr('auth_title'));
}

function setAuthStatus(key, tone = '') {
  state.authStatusKey = key;
  state.authStatusTone = tone;
  const status = qs('authStatus');
  if (status) {
    status.textContent = tr(key);
    status.classList.toggle('is-error', tone === 'error');
    status.classList.toggle('is-success', tone === 'success');
  }
  syncAuthGateVisualState();
}

function setAuthBusy(isBusy) {
  state.authBusy = !!isBusy;
  const buttons = [qs('authGoogleBtn'), qs('migrationContinueBtn')].filter(Boolean);
  buttons.forEach((button) => {
    button.disabled = !!isBusy;
  });
  syncAuthGateVisualState();
}

function showAuthGate(visible) {
  const gate = qs('authGate');
  if (!gate) return;
  gate.classList.toggle('is-hidden', !visible);
}

function showMigrationModal(visible) {
  const modal = qs('migrationModal');
  if (!modal) return;
  modal.classList.toggle('is-open', !!visible);
  modal.style.display = visible ? 'flex' : 'none';
}

function syncMigrationModalVisibility() {
  showMigrationModal(false);
}

function renderStaticCopy() {
  setText('profileMenuLabel', tr('profile_menu'));
  setText('profileSwitchLabel', tr('profile_switch'));
  setText('profileMenuSignOutLabel', tr('profile_signout'));
  setText('authKicker', tr('auth_kicker'));
  setText('authTitle', tr('auth_title'));
  setText('authBody', tr('auth_body'));
  setText('authGoogleBtnLabel', tr('auth_button'));
  setText('authAsideLabel', tr('auth_aside_label'));
  setText('authBenefitHistory', tr('auth_benefit_history'));
  setText('authBenefitPresets', tr('auth_benefit_presets'));
  setText('authBenefitInspiration', tr('auth_benefit_inspiration'));
  setText('migrationPill', tr('migration_pill'));
  setText('migrationTitle', tr('migration_title'));
  setText('migrationBody', tr('migration_body'));
  setText('migrationContinueLabel', state.migrationRunning ? tr('migration_running_button') : tr('migration_button'));
  setText('profileBackLabel', tr('profile_back'));
  setText('profileKicker', tr('profile_kicker'));
  setText('profilePageTitle', tr('profile_title'));
  setText('profileSignOutLabel', tr('profile_signout'));
  setText('profileHistoryLabel', tr('profile_history_label'));
  setText('profilePresetLabel', tr('profile_preset_label'));
  setText('profileInspirationLabel', tr('profile_inspiration_label'));
  setText('profileFutureLabelCredits', tr('profile_future_credits_label'));
  setText('profileFutureBodyCredits', tr('profile_future_credits_body'));
  setText('profileFutureLabelSubscription', tr('profile_future_subscription_label'));
  setText('profileFutureBodySubscription', tr('profile_future_subscription_body'));
  const profileBtn = qs('profileBtn');
  if (profileBtn) profileBtn.title = tr('profile_menu_button');
  setAuthStatus(state.authStatusKey, state.authStatusTone);
  updateProfileView();
}

function formatCreatedAt(value) {
  if (!value) return `${tr('profile_created_prefix')} -`;
  const date = new Date(value);
  const localized = date.toLocaleDateString(window.I18N ? window.I18N.lang : undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
  return `${tr('profile_created_prefix')} ${localized}`;
}

function mergeSummaryCounts(baseSummary, liveSummary) {
  const base = baseSummary || {};
  const live = liveSummary || {};
  return {
    historyCount: Math.max(Number(base.historyCount) || 0, Number(live.historyCount) || 0),
    presetCount: Math.max(Number(base.presetCount) || 0, Number(live.presetCount) || 0),
    customDesignPresetCount: Math.max(Number(base.customDesignPresetCount) || 0, Number(live.customDesignPresetCount) || 0),
  };
}

function getSummarySnapshot() {
  const liveSummary = window.NanoApp && typeof window.NanoApp.getAccountSummarySnapshot === 'function'
    ? window.NanoApp.getAccountSummarySnapshot()
    : null;
  return mergeSummaryCounts(state.summary, liveSummary);
}

function updateHeaderIdentity() {
  const name = state.user ? getDisplayName() : 'Guest';
  const email = state.user && state.user.email ? state.user.email : '';
  const avatarUrl = state.user ? getAvatarUrl() : '';
  const profileBtn = qs('profileBtn');
  const profileBtnAvatar = qs('profileBtnAvatar');
  const profileBtnIcon = qs('profileBtnIcon');
  const summary = qs('accountMenuSummary');
  const openEntry = qs('profileOpenDropdown');
  const switchEntry = qs('profileSwitchDropdown');
  const signOutEntry = qs('profileSignOutDropdown');
  const divider = qs('profileDropdownDivider');
  if (state.user) {
    if (profileBtn) profileBtn.classList.add('has-avatar');
    if (profileBtnAvatar) {
      profileBtnAvatar.style.display = 'flex';
      paintAvatar(profileBtnAvatar, name, avatarUrl);
    }
    if (profileBtnIcon) profileBtnIcon.style.display = 'none';
    if (summary) summary.style.display = 'flex';
    paintAvatar(qs('accountMenuAvatar'), name, avatarUrl);
    setText('accountMenuName', name);
    setText('accountMenuEmail', email);
    if (openEntry) openEntry.disabled = false;
    if (switchEntry) switchEntry.style.display = '';
    if (signOutEntry) signOutEntry.style.display = '';
    if (divider) divider.style.display = '';
  } else {
    if (profileBtn) profileBtn.classList.remove('has-avatar');
    if (profileBtnAvatar) profileBtnAvatar.style.display = 'none';
    if (profileBtnIcon) profileBtnIcon.style.display = '';
    if (summary) summary.style.display = 'none';
    if (openEntry) openEntry.disabled = true;
    if (switchEntry) switchEntry.style.display = 'none';
    if (signOutEntry) signOutEntry.style.display = 'none';
    if (divider) divider.style.display = 'none';
  }
}

function updateProfileView() {
  const name = state.user ? getDisplayName() : 'Guest';
  const email = state.user && state.user.email ? state.user.email : 'guest@example.com';
  const avatarUrl = state.user ? getAvatarUrl() : '';
  paintAvatar(qs('profileAvatar'), name, avatarUrl);
  setText('profileName', name);
  setText('profileEmail', email);
  const summary = getSummarySnapshot();
  setText('profileHistoryCount', String(summary.historyCount || 0));
  setText('profilePresetCount', String(summary.presetCount || 0));
  setText('profileInspirationCount', String(summary.customDesignPresetCount || 0));
  setText('profileCreatedAt', formatCreatedAt(state.profile && (state.profile.created_at || state.profile.updated_at)));
  const marker = readMigrationMarker();
  const migrationDone = !!((state.profile && state.profile.migrated_local_data_at) || (marker && marker.consumed && state.user && marker.userId === state.user.id));
  setText('profileMigrationState', migrationDone ? tr('profile_migration_done') : tr('profile_migration_none'));
}

function refreshAccountUi() {
  updateHeaderIdentity();
  updateProfileView();
  renderStaticCopy();
  refreshIcons();
}

function isSameSignedInUser(session) {
  return !!(session && session.user && state.user && session.user.id === state.user.id);
}

function updateSessionIdentity(session) {
  state.session = session || null;
  state.user = session && session.user ? session.user : null;
  state.authResolved = true;
  state.hadAuthenticatedSession = !!state.user;
  if (session && session.user) {
    persistSessionBackup(session);
    state.signOutPending = false;
  }
  setAuthBusy(false);
  showAuthGate(false);
  refreshAccountUi();
}

function hasCachedAccountData(data) {
  if (!data || typeof data !== 'object') return false;
  const summary = data.summary || {};
  const design = data.designPresetState || {};
  return !!(
    (Array.isArray(data.history) && data.history.length)
    || (summary.historyCount > 0)
    || (summary.presetCount > 0)
    || (summary.customDesignPresetCount > 0)
    || (Array.isArray(design.hiddenBuiltins) && design.hiddenBuiltins.length > 0)
    || (design.nameOverrides && typeof design.nameOverrides === 'object' && Object.keys(design.nameOverrides).length > 0)
    || (Array.isArray(design.customPresets) && design.customPresets.length > 0)
    || !!(design.meta && design.meta.dirty)
  );
}

function hasDesignPresetStateContent(state) {
  const nextState = state || {};
  return !!(
    (Array.isArray(nextState.hiddenBuiltins) && nextState.hiddenBuiltins.length > 0)
    || (nextState.nameOverrides && typeof nextState.nameOverrides === 'object' && Object.keys(nextState.nameOverrides).length > 0)
    || (Array.isArray(nextState.customPresets) && nextState.customPresets.length > 0)
  );
}

function normalizeDesignPresetState(state) {
  const nextState = state || {};
  return {
    hiddenBuiltins: Array.isArray(nextState.hiddenBuiltins) ? nextState.hiddenBuiltins.slice() : [],
    nameOverrides: nextState.nameOverrides && typeof nextState.nameOverrides === 'object' ? { ...nextState.nameOverrides } : {},
    customPresets: Array.isArray(nextState.customPresets) ? nextState.customPresets.slice() : [],
  };
}

function mergeDesignPresetCustomPreset(localPreset, remotePreset) {
  const local = localPreset && typeof localPreset === 'object' ? localPreset : {};
  const remote = remotePreset && typeof remotePreset === 'object' ? remotePreset : {};
  return {
    ...remote,
    ...local,
    id: local.id || remote.id || null,
    name: local.name || remote.name || 'Custom Preset',
    src: local.src || remote.src || local.dataUrl || remote.dataUrl || null,
    dataUrl: local.dataUrl || remote.dataUrl || null,
    storagePath: local.storagePath || remote.storagePath || null,
    createdAt: local.createdAt || remote.createdAt || null,
  };
}

function mergeDesignPresetState(localState, remoteState) {
  const local = normalizeDesignPresetState(localState);
  const remote = normalizeDesignPresetState(remoteState);
  const hiddenBuiltins = Array.from(new Set([...(remote.hiddenBuiltins || []), ...(local.hiddenBuiltins || [])]));
  const nameOverrides = { ...(remote.nameOverrides || {}), ...(local.nameOverrides || {}) };
  const customPresetMap = new Map();

  (remote.customPresets || []).forEach((preset) => {
    if (!preset || !preset.id) return;
    customPresetMap.set(String(preset.id), mergeDesignPresetCustomPreset(null, preset));
  });
  (local.customPresets || []).forEach((preset) => {
    if (!preset || !preset.id) return;
    const id = String(preset.id);
    customPresetMap.set(id, mergeDesignPresetCustomPreset(preset, customPresetMap.get(id) || null));
  });

  return {
    hiddenBuiltins,
    nameOverrides,
    customPresets: Array.from(customPresetMap.values()).filter((preset) => preset && preset.id),
  };
}

function stableDesignPresetState(state) {
  const next = normalizeDesignPresetState(state);
  const hiddenBuiltins = Array.from(new Set(next.hiddenBuiltins || [])).sort();
  const nameOverrides = Object.keys(next.nameOverrides || {}).sort().reduce((acc, key) => {
    acc[key] = next.nameOverrides[key];
    return acc;
  }, {});
  const customPresets = (next.customPresets || [])
    .filter((preset) => preset && preset.id)
    .map((preset) => ({
      id: String(preset.id),
      name: preset.name || 'Custom Preset',
      src: preset.src || null,
      dataUrl: preset.dataUrl || null,
      storagePath: preset.storagePath || null,
      createdAt: preset.createdAt || null,
    }))
    .sort((a, b) => a.id.localeCompare(b.id));
  return { hiddenBuiltins, nameOverrides, customPresets };
}

function designPresetStatesEqual(left, right) {
  return JSON.stringify(stableDesignPresetState(left)) === JSON.stringify(stableDesignPresetState(right));
}

function shouldPreferLocalDesignPresetState(localState, remoteState) {
  const localMeta = localState && localState.meta ? localState.meta : {};
  if (localMeta.dirty) return true;
  return hasDesignPresetStateContent(localState) && !hasDesignPresetStateContent(remoteState);
}

function historyCacheMatchesRemote(cachedMeta, remoteMeta) {
  const cachedCount = Number(cachedMeta && cachedMeta.count) || 0;
  const cachedStoredCount = Number(cachedMeta && cachedMeta.cachedCount) || 0;
  const remoteCount = Number(remoteMeta && remoteMeta.totalCount) || 0;
  const cachedNewestId = cachedMeta && cachedMeta.newestId ? String(cachedMeta.newestId) : null;
  const remoteNewestId = remoteMeta && remoteMeta.newestId ? String(remoteMeta.newestId) : null;
  const cachedNewestTimestamp = Number.isFinite(Number(cachedMeta && cachedMeta.newestTimestamp)) ? Number(cachedMeta.newestTimestamp) : null;
  const remoteNewestTimestamp = Number.isFinite(Number(remoteMeta && remoteMeta.newestTimestamp)) ? Number(remoteMeta.newestTimestamp) : null;
  const cacheComplete = !!(cachedMeta && cachedMeta.complete !== false);
  if (cachedCount === 0 || remoteCount === 0) return cachedCount === remoteCount;
  if (!cacheComplete && remoteCount > cachedStoredCount) return false;
  if (cachedNewestId && remoteNewestId && cachedNewestId === remoteNewestId) {
    return cacheComplete || cachedStoredCount >= Math.min(remoteCount, cachedCount);
  }
  if (cachedNewestTimestamp !== null && remoteNewestTimestamp !== null) {
    return cachedNewestTimestamp === remoteNewestTimestamp && cacheComplete;
  }
  return cacheComplete && cachedCount === remoteCount;
}
async function hydrateFromScopedCache(userId, options = {}) {
  if (!window.NanoApp || typeof window.NanoApp.getScopedLocalAccountData !== 'function' || typeof window.NanoApp.applyAccountData !== 'function') {
    return false;
  }
  const includeHistory = options.includeHistory === true;
  const cached = await window.NanoApp.getScopedLocalAccountData(userId, { includeHistory });
  if (!hasCachedAccountData(cached)) return false;
  await window.NanoApp.applyAccountData(cached, { skipHistory: !includeHistory });
  state.summary = mergeSummaryCounts(state.summary, cached.summary || null);
  state.authResolved = true;
  state.hadAuthenticatedSession = true;
  refreshAccountUi();
  return true;
}

async function hydrateRemainingHistory(historyMeta, userId, hydrationNonce, options = {}) {
  if (!window.NanoApp || typeof window.NanoApp.appendHistoryFromAccount !== 'function') return;
  const replaceExisting = !!options.replaceExisting;
  const collected = [];
  let batch = [];
  let nextOffset = Number.isFinite(Number(options && options.startOffset))
    ? Math.max(0, Number(options.startOffset))
    : (Number.isFinite(Number(historyMeta && historyMeta.nextOffset))
      ? Math.max(0, Number(historyMeta.nextOffset))
      : null);
  while (nextOffset !== null) {
    const result = await requestJson(ACCOUNT_ENDPOINT, {
      method: 'POST',
      body: {
        action: 'load-history-page',
        offset: nextOffset,
        limit: ACCOUNT_HISTORY_PAGE_SIZE,
      },
    });
    if (hydrationNonce !== state.historyHydrationNonce || !state.user || state.user.id !== userId) return;
    if (Array.isArray(result.items) && result.items.length) {
      if (replaceExisting) {
        collected.push(...result.items);
      } else {
        batch.push(...result.items);
        if (batch.length >= ACCOUNT_HISTORY_PAGE_SIZE * 3) {
          window.NanoApp.appendHistoryFromAccount(batch, { persist: false });
          batch = [];
        }
      }
      state.summary = mergeSummaryCounts(state.summary, {
        historyCount: Number(historyMeta && historyMeta.totalCount) || 0,
      });
      updateProfileView();
    }
    nextOffset = Number.isFinite(Number(result.nextOffset)) ? Math.max(0, Number(result.nextOffset)) : null;
    if (nextOffset !== null) {
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  }
  if (hydrationNonce !== state.historyHydrationNonce || !state.user || state.user.id !== userId) return;
  if (replaceExisting) {
    window.NanoApp.replaceHistoryFromAccount(collected, { persist: true });
  } else {
    if (batch.length) window.NanoApp.appendHistoryFromAccount(batch, { persist: false });
    if (typeof window.NanoApp.persistHistoryCache === 'function') {
      window.NanoApp.persistHistoryCache();
    }
  }
}
function openProfilePage() {
  if (!state.user) return;
  const page = qs('profilePage');
  if (!page) return;
  page.style.display = 'block';
  page.classList.add('is-open');
  document.body.style.overflow = 'hidden';
}

function closeProfilePage() {
  const page = qs('profilePage');
  if (!page) return;
  page.classList.remove('is-open');
  page.style.display = 'none';
  document.body.style.overflow = '';
}

window.openProfilePage = openProfilePage;
window.closeProfilePage = closeProfilePage;
window.switchAccountFromMenu = () => switchAccount();
window.signOutFromMenu = () => signOut();

async function restoreSessionFromBackup(reason = 'restore') {
  if (!state.client || !state.client.auth) return null;
  const backup = readStoredSessionBackup();
  if (!backup || !backup.access_token || !backup.refresh_token) return null;
  try {
    const result = await state.client.auth.setSession({
      access_token: backup.access_token,
      refresh_token: backup.refresh_token,
    });
    if (result.error) throw result.error;
    const session = result.data && result.data.session ? result.data.session : null;
    if (session) {
      persistSessionBackup(session);
      return session;
    }
  } catch (error) {
    console.warn(`Session restore failed (${reason})`, error);
    clearSessionBackup();
  }
  return null;
}

async function resolvePersistedSession(options = {}) {
  if (!state.client || !state.client.auth) return state.session || null;
  const forceRefresh = options.forceRefresh === true;
  const allowBackup = options.allowBackup !== false;
  const reason = options.reason || 'resolve';
  let nextSession = null;

  try {
    if (forceRefresh && typeof state.client.auth.refreshSession === 'function') {
      const refreshResult = await state.client.auth.refreshSession();
      if (!refreshResult.error && refreshResult.data && refreshResult.data.session) {
        nextSession = refreshResult.data.session;
      }
    }
    if (!nextSession) {
      const sessionResult = await state.client.auth.getSession();
      nextSession = sessionResult && sessionResult.data ? (sessionResult.data.session || null) : null;
    }
  } catch (error) {
    console.warn(`Supabase session resolve failed (${reason})`, error);
  }

  if (nextSession) {
    persistSessionBackup(nextSession);
    state.signOutPending = false;
    return nextSession;
  }

  if (!allowBackup || state.signOutPending || state.accountSwitching) return null;
  return restoreSessionFromBackup(reason);
}

async function probeSessionOnResume() {
  if (!state.client || !state.configured) return;
  if (state.accountSwitching || state.signOutPending) return;
  if (!(state.user || state.session || hasStoredSessionBackup())) return;
  const now = Date.now();
  if (now - state.lastSessionProbeAt < SESSION_RESUME_PROBE_MS) return;
  state.lastSessionProbeAt = now;
  try {
    const session = await resolvePersistedSession({
      forceRefresh: true,
      allowBackup: true,
      reason: 'resume-probe',
    });
    if (!session) return;
    if (isSameSignedInUser(session) && state.bootstrapComplete) {
      updateSessionIdentity(session);
      return;
    }
    await handleSession(session);
  } catch (error) {
    console.warn('Session resume probe failed', error);
  }
}

async function refreshCurrentSession(forceRefresh = false) {
  if (!state.client || !state.client.auth) return state.session || null;
  try {
    const nextSession = await resolvePersistedSession({
      forceRefresh,
      allowBackup: true,
      reason: forceRefresh ? 'refresh-session' : 'get-session',
    });
    if (nextSession) state.session = nextSession;
    return nextSession || null;
  } catch (error) {
    console.error('refreshCurrentSession failed', error);
    return state.session || null;
  }
}

async function requestJson(url, options = {}) {
  const requestOptions = { ...options };
  const retryAuth = !!requestOptions.__authRetry;
  delete requestOptions.__authRetry;
  const headers = new Headers(requestOptions.headers || {});
  const body = requestOptions.body;
  if (body && !(body instanceof FormData) && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }
  if ((!state.session || !state.session.access_token) && state.client) {
    await refreshCurrentSession(false);
  }
  if (state.session && state.session.access_token) {
    headers.set('Authorization', `Bearer ${state.session.access_token}`);
  }
  const response = await fetch(url, {
    ...requestOptions,
    headers,
    body: body && !(body instanceof FormData) && typeof body !== 'string' ? JSON.stringify(body) : body,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    if (response.status === 401 && !retryAuth && state.client) {
      const refreshed = await refreshCurrentSession(true);
      if (refreshed && refreshed.access_token) {
        return requestJson(url, { ...requestOptions, __authRetry: true });
      }
    }
    throw new Error(data && data.error ? data.error : `${response.status} ${response.statusText}`);
  }
  return data;
}

function hasLegacyPayload(payload) {
  if (!payload) return false;
  const hasHistory = Array.isArray(payload.history) && payload.history.length > 0;
  const hasTitle = payload.titleStore && Object.keys(payload.titleStore).length > 0;
  const hasChar = payload.charStore && Object.keys(payload.charStore).length > 0;
  const design = payload.designPresetState || {};
  const hasDesignMeta = Array.isArray(design.hiddenBuiltins) && design.hiddenBuiltins.length > 0;
  const hasNames = design.nameOverrides && Object.keys(design.nameOverrides).length > 0;
  const hasCustom = Array.isArray(design.customPresets) && design.customPresets.length > 0;
  return hasHistory || hasTitle || hasChar || hasDesignMeta || hasNames || hasCustom;
}

async function refreshLegacyPayload() {
  state.legacyPayload = null;
  state.legacyPending = false;
  state.legacyScanComplete = true;
  syncMigrationModalVisibility();
}

async function handleSignedOut(clearAccountState) {
  const switching = !!state.accountSwitching;
  const nextStatusKey = switching
    ? 'auth_status_switching'
    : (clearAccountState ? 'auth_status_signed_out' : (state.configured ? 'auth_status_idle' : 'auth_status_missing_config'));
  const nextStatusTone = switching ? '' : (!state.configured ? 'error' : '');
  closeProfilePage();
  if (clearAccountState && window.NanoApp && typeof window.NanoApp.clearSignedInAccountData === 'function') {
    await window.NanoApp.clearSignedInAccountData();
  }
  if (window.NanoApp && typeof window.NanoApp.setAccountStorageScope === 'function') {
    window.NanoApp.setAccountStorageScope(null, { loadTasks: false, loadHistory: false });
  }
  if (window.NanoApp && typeof window.NanoApp.setHistoryHydrating === 'function') {
    window.NanoApp.setHistoryHydrating(false);
  }
  state.historyHydrationNonce += 1;
  state.session = null;
  state.user = null;
  state.profile = null;
  state.summary = null;
  state.bootstrapComplete = false;
  state.authResolved = true;
  state.hadAuthenticatedSession = false;
  state.signOutPending = false;
  state.legacyPayload = null;
  state.legacyPending = false;
  state.legacyScanComplete = true;
  setAuthBusy(switching);
  setAuthStatus(nextStatusKey, nextStatusTone);
  showAuthGate(true);
  showMigrationModal(false);
  refreshAccountUi();
  if (!switching) {
    setAuthBusy(false);
    syncMigrationModalVisibility();
  }
}

async function migrateLegacyDataIfNeeded(initialData) {
  state.legacyPayload = null;
  state.legacyPending = false;
  state.legacyScanComplete = true;
  syncMigrationModalVisibility();
  return initialData;
}

async function bootstrapForSession(session, options = {}) {
  const silent = !!options.silent;
  const preferCached = !!options.preferCached;
  state.session = session;
  state.user = session.user;
  state.bootstrapComplete = false;
  state.authResolved = false;
  state.accountSwitching = false;
  const nonce = ++state.bootNonce;
  const historyHydrationNonce = ++state.historyHydrationNonce;
  let hydratedFromCache = false;
  state.legacyPayload = null;
  state.legacyPending = false;
  state.legacyScanComplete = true;
  if (window.NanoApp && typeof window.NanoApp.setAccountStorageScope === 'function') {
    window.NanoApp.setAccountStorageScope(state.user.id, { loadTasks: true, loadHistory: false });
  }
  const warmHistoryMeta = window.NanoApp && typeof window.NanoApp.getScopedHistoryCacheMeta === 'function'
    ? window.NanoApp.getScopedHistoryCacheMeta(state.user.id)
    : { count: 0, cachedCount: 0, complete: false };
  const shouldWarmHistory = (Number(warmHistoryMeta && (warmHistoryMeta.cachedCount || warmHistoryMeta.count)) || 0) > 0;
  if (preferCached) {
    try {
      hydratedFromCache = await hydrateFromScopedCache(state.user.id, { includeHistory: shouldWarmHistory });
    } catch (error) {
      console.error('hydrateFromScopedCache failed', error);
    }
  }
  setAuthStatus('auth_status_loading');
  if (!silent && !hydratedFromCache) {
    setAuthBusy(true);
    showAuthGate(true);
  } else {
    setAuthBusy(false);
    showAuthGate(false);
  }
  const data = await requestJson(ACCOUNT_ENDPOINT, {
    method: 'POST',
    body: { action: 'bootstrap' },
  });
  if (nonce !== state.bootNonce) return;
  const remoteHistoryMeta = data && data.historyMeta ? data.historyMeta : null;
  const remoteHistoryCount = Number(remoteHistoryMeta && remoteHistoryMeta.totalCount) || 0;
  const bootstrapHistory = Array.isArray(data && data.history) ? data.history : [];
  let cachedHistoryMeta = window.NanoApp && typeof window.NanoApp.getScopedHistoryCacheMeta === 'function'
    ? window.NanoApp.getScopedHistoryCacheMeta(state.user.id)
    : { count: 0, cachedCount: 0, complete: false };
  let cachedHistoryCount = Number(cachedHistoryMeta && cachedHistoryMeta.count) || 0;
  const cachedVisibleCount = Number(cachedHistoryMeta && (cachedHistoryMeta.cachedCount || cachedHistoryMeta.count)) || 0;

  if (!hydratedFromCache && cachedVisibleCount > 0 && window.NanoApp && typeof window.NanoApp.hydrateHistoryFromScopedCache === 'function') {
    try {
      await window.NanoApp.hydrateHistoryFromScopedCache(state.user.id);
      hydratedFromCache = true;
    } catch (error) {
      console.error('hydrateHistoryFromScopedCache failed', error);
    }
    cachedHistoryMeta = window.NanoApp && typeof window.NanoApp.getScopedHistoryCacheMeta === 'function'
      ? window.NanoApp.getScopedHistoryCacheMeta(state.user.id)
      : { count: 0, cachedCount: 0, complete: false };
    cachedHistoryCount = Number(cachedHistoryMeta && cachedHistoryMeta.count) || 0;
  }

  const cacheMatchesRemote = historyCacheMatchesRemote(cachedHistoryMeta, remoteHistoryMeta);
  const hasVisibleCachedHistory = cachedVisibleCount > 0;
  const shouldMergeBootstrapHistory = bootstrapHistory.length > 0 && (cachedHistoryCount === 0 || !cacheMatchesRemote);
  let shouldResyncLocalDesignState = false;

  if (window.NanoApp && typeof window.NanoApp.getScopedLocalAccountData === 'function') {
    try {
      const localAccountData = await window.NanoApp.getScopedLocalAccountData(state.user.id, { includeHistory: false });
      const localDesignState = localAccountData && localAccountData.designPresetState ? localAccountData.designPresetState : null;
      const mergedDesignState = mergeDesignPresetState(localDesignState, data && data.designPresetState);
      if (shouldPreferLocalDesignPresetState(localDesignState, data && data.designPresetState) || !designPresetStatesEqual(mergedDesignState, data && data.designPresetState)) {
        data.designPresetState = mergedDesignState;
        shouldResyncLocalDesignState = true;
      }
    } catch (error) {
      console.warn('Failed to read scoped local design preset state during bootstrap', error);
    }
  }

  if (window.NanoApp && typeof window.NanoApp.applyAccountData === 'function') {
    await window.NanoApp.applyAccountData(data, { skipHistory: hasVisibleCachedHistory || !shouldMergeBootstrapHistory });
  }
  if (remoteHistoryCount === 0 && cachedHistoryCount > 0 && window.NanoApp && typeof window.NanoApp.replaceHistoryFromAccount === 'function') {
    window.NanoApp.replaceHistoryFromAccount([], { persist: true });
  } else if (hasVisibleCachedHistory && shouldMergeBootstrapHistory && window.NanoApp && typeof window.NanoApp.appendHistoryFromAccount === 'function') {
    window.NanoApp.appendHistoryFromAccount(bootstrapHistory, { persist: false });
  }

  const effectiveHistoryMeta = window.NanoApp && typeof window.NanoApp.getScopedHistoryCacheMeta === 'function'
    ? window.NanoApp.getScopedHistoryCacheMeta(state.user.id)
    : cachedHistoryMeta;
  const liveSummary = window.NanoApp && typeof window.NanoApp.getAccountSummarySnapshot === 'function'
    ? window.NanoApp.getAccountSummarySnapshot()
    : null;
  state.profile = data.profile || null;
  state.summary = mergeSummaryCounts(mergeSummaryCounts(data.summary, liveSummary), {
    historyCount: remoteHistoryCount || Number(effectiveHistoryMeta && effectiveHistoryMeta.count) || 0,
  });
  state.bootstrapComplete = true;
  state.authResolved = true;
  state.hadAuthenticatedSession = true;
  setAuthBusy(false);
  showAuthGate(false);
  refreshAccountUi();
  if (shouldResyncLocalDesignState) {
    queueDesignPresetSync();
  }

  const canResumeHydrationFromCache = !!(
    cachedVisibleCount > 0
    && remoteHistoryMeta
    && ((cachedHistoryMeta && cachedHistoryMeta.newestId && remoteHistoryMeta.newestId && String(cachedHistoryMeta.newestId) === String(remoteHistoryMeta.newestId))
      || (Number.isFinite(Number(cachedHistoryMeta && cachedHistoryMeta.newestTimestamp))
        && Number.isFinite(Number(remoteHistoryMeta && remoteHistoryMeta.newestTimestamp))
        && Number(cachedHistoryMeta.newestTimestamp) === Number(remoteHistoryMeta.newestTimestamp)))
  );
  const hydrationStartOffset = canResumeHydrationFromCache
    ? Math.max(Number(remoteHistoryMeta && remoteHistoryMeta.nextOffset) || 0, cachedVisibleCount)
    : null;
  const needsHistoryHydration = !!(remoteHistoryMeta && remoteHistoryMeta.nextOffset !== null && (cachedVisibleCount === 0 || !cacheMatchesRemote));
  if (window.NanoApp && typeof window.NanoApp.setHistoryHydrating === 'function') {
    window.NanoApp.setHistoryHydrating(needsHistoryHydration);
  }
  if (needsHistoryHydration) {
    hydrateRemainingHistory(remoteHistoryMeta, state.user.id, historyHydrationNonce, {
      replaceExisting: false,
      startOffset: hydrationStartOffset,
    })
      .catch((error) => {
        if (historyHydrationNonce !== state.historyHydrationNonce) return;
        console.error('hydrateRemainingHistory failed', error);
      })
      .finally(() => {
        if (historyHydrationNonce !== state.historyHydrationNonce) return;
        if (window.NanoApp && typeof window.NanoApp.setHistoryHydrating === 'function') {
          window.NanoApp.setHistoryHydrating(false);
        }
      });
  }
}
async function syncTextPresetsNow() {
  if (!state.bootstrapComplete || !state.user || !window.NanoApp) return;
  const stores = window.NanoApp.getTextPresetStoresSnapshot();
  await requestJson(ACCOUNT_ENDPOINT, {
    method: 'POST',
    body: { action: 'save-text-presets', ...stores },
  });
  state.summary = mergeSummaryCounts(state.summary, window.NanoApp.getAccountSummarySnapshot());
  updateProfileView();
}

async function syncDesignPresetsNow() {
  if (!state.bootstrapComplete || !state.user || !window.NanoApp) return;
  const rawDesignPresetState = window.NanoApp.getDesignPresetStateSnapshot();
  let skippedCustomPresetCount = 0;
  const designPresetState = {
    hiddenBuiltins: Array.isArray(rawDesignPresetState && rawDesignPresetState.hiddenBuiltins) ? rawDesignPresetState.hiddenBuiltins : [],
    nameOverrides: rawDesignPresetState && typeof rawDesignPresetState.nameOverrides === 'object' ? rawDesignPresetState.nameOverrides : {},
    customPresets: (Array.isArray(rawDesignPresetState && rawDesignPresetState.customPresets) ? rawDesignPresetState.customPresets : [])
      .map((preset) => {
        if (!preset || typeof preset !== 'object') return null;
        const safeSrc = (typeof preset.src === 'string' && preset.src && !/^data:/i.test(preset.src)) ? preset.src : null;
        const safeDataUrl = (typeof preset.dataUrl === 'string' && preset.dataUrl && preset.dataUrl.length <= 180000) ? preset.dataUrl : null;
        if (!preset.storagePath && !safeSrc && !safeDataUrl) {
          skippedCustomPresetCount += 1;
          return null;
        }
        return {
          ...preset,
          src: safeSrc,
          dataUrl: safeDataUrl,
        };
      })
      .filter(Boolean),
  };
  await requestJson(ACCOUNT_ENDPOINT, {
    method: 'POST',
    body: { action: 'save-design-presets', designPresetState },
  });
  if (skippedCustomPresetCount === 0 && typeof window.NanoApp.markDesignPresetSyncClean === 'function') {
    window.NanoApp.markDesignPresetSyncClean(state.user.id);
  }
  state.summary = mergeSummaryCounts(state.summary, window.NanoApp.getAccountSummarySnapshot());
  updateProfileView();
}

async function flushHistoryQueue() {
  if (!state.bootstrapComplete || !state.user || !window.NanoApp) {
    syncState.historyQueue.forEach((item) => { if (item) delete item.__accountPersistQueued; });
    syncState.historyQueue = [];
    return;
  }
  const batch = syncState.historyQueue.splice(0);
  if (!batch.length) return;
  try {
    const result = await requestJson(ACCOUNT_ENDPOINT, {
      method: 'POST',
      body: { action: 'save-history', items: batch },
    });
    if (window.NanoApp && typeof window.NanoApp.mergePersistedHistoryItems === 'function') {
      window.NanoApp.mergePersistedHistoryItems(batch, result.items || []);
    }
    state.summary = mergeSummaryCounts(state.summary, window.NanoApp.getAccountSummarySnapshot());
    updateProfileView();
  } catch (error) {
    console.error('history sync failed', error);
    batch.forEach((item) => { if (item) delete item.__accountPersistQueued; });
  }
}

function queueHistoryPersist(items) {
  if (!state.bootstrapComplete || !state.user) return;
  const nextItems = Array.isArray(items) ? items : [items];
  nextItems.forEach((item) => {
    if (!item || item.cloud || item.__accountPersistQueued) return;
    item.__accountPersistQueued = true;
    syncState.historyQueue.push(item);
  });
  if (syncState.historyTimer) clearTimeout(syncState.historyTimer);
  syncState.historyTimer = setTimeout(() => {
    syncState.historyTimer = null;
    flushHistoryQueue();
  }, 420);
}

async function queueHistoryDelete(item) {
  if (!state.bootstrapComplete || !state.user || !item || !item.id || syncState.historyDeleting.has(item.id)) return;
  syncState.historyDeleting.add(item.id);
  try {
    await requestJson(ACCOUNT_ENDPOINT, {
      method: 'POST',
      body: { action: 'delete-history', id: item.id },
    });
    state.summary = mergeSummaryCounts(state.summary, window.NanoApp.getAccountSummarySnapshot());
    updateProfileView();
  } catch (error) {
    console.error('history delete failed', error);
  } finally {
    syncState.historyDeleting.delete(item.id);
  }
}

function queueTextPresetSync() {
  if (!state.bootstrapComplete || !state.user) return;
  if (syncState.textTimer) clearTimeout(syncState.textTimer);
  syncState.textTimer = setTimeout(() => {
    syncState.textTimer = null;
    syncTextPresetsNow().catch((error) => console.error('text preset sync failed', error));
  }, 320);
}

function queueDesignPresetSync() {
  if (!state.bootstrapComplete || !state.user) return;
  if (syncState.designTimer) clearTimeout(syncState.designTimer);
  syncState.designTimer = setTimeout(() => {
    syncState.designTimer = null;
    syncDesignPresetsNow().catch((error) => console.error('design preset sync failed', error));
  }, 480);
}

async function signInWithGoogle(options = {}) {
  if (!state.client || !state.configured) return;
  state.signOutPending = false;
  const prompt = Object.prototype.hasOwnProperty.call(options, 'prompt') ? options.prompt : 'select_account';
  const statusKey = options.statusKey || 'auth_status_signing_in';
  setAuthBusy(true);
  setAuthStatus(statusKey);
  const redirectTo = `${window.location.origin}${window.location.pathname}${window.location.search}`;
  const queryParams = {};
  if (prompt) queryParams.prompt = prompt;
  const { error } = await state.client.auth.signInWithOAuth({
    provider: 'google',
    options: {
      redirectTo,
      queryParams,
    },
  });
  if (error) {
    state.accountSwitching = false;
    console.error('signInWithGoogle failed', error);
    setAuthBusy(false);
    setAuthStatus('auth_status_failed', 'error');
  }
}

async function switchAccount() {
  if (!state.client || !state.configured || !state.user) return;
  state.accountSwitching = true;
  state.signOutPending = true;
  closeProfilePage();
  setAuthBusy(true);
  setAuthStatus('auth_status_switching');
  try {
    await state.client.auth.signOut();
    clearSessionBackup();
    await signInWithGoogle({ prompt: 'select_account', statusKey: 'auth_status_switching' });
  } catch (error) {
    state.accountSwitching = false;
    state.signOutPending = false;
    console.error('switchAccount failed', error);
    setAuthBusy(false);
    setAuthStatus('auth_status_failed', 'error');
  }
}

async function signOut() {
  if (!state.client) return;
  state.accountSwitching = false;
  state.signOutPending = true;
  closeProfilePage();
  setAuthBusy(true);
  setAuthStatus('auth_status_loading');
  try {
    await state.client.auth.signOut();
    clearSessionBackup();
  } catch (error) {
    state.signOutPending = false;
    console.error('signOut failed', error);
    setAuthBusy(false);
    setAuthStatus('auth_status_failed', 'error');
  }
}

async function handleSession(session) {
  if (!state.configured) {
    showAuthGate(true);
    setAuthBusy(true);
    setAuthStatus('auth_status_missing_config', 'error');
    refreshAccountUi();
    return;
  }

  if (!session) {
    if (!state.accountSwitching && !state.signOutPending) {
      const recoveredSession = await resolvePersistedSession({
        allowBackup: true,
        reason: state.hadAuthenticatedSession ? 'empty-session-after-login' : 'empty-session-init',
      });
      if (recoveredSession) {
        session = recoveredSession;
      }
    }
  }

  if (!session) {
    await handleSignedOut(state.hadAuthenticatedSession);
    return;
  }

  if (isSameSignedInUser(session) && state.bootstrapComplete) {
    updateSessionIdentity(session);
    return;
  }

  try {
    await bootstrapForSession(session, {
      silent: isSameSignedInUser(session) && state.hadAuthenticatedSession,
      preferCached: !state.hadAuthenticatedSession,
    });
  } catch (error) {
    console.error('bootstrapForSession failed', error);
    setAuthBusy(false);
    if (window.NanoApp && typeof window.NanoApp.setHistoryHydrating === 'function') {
      window.NanoApp.setHistoryHydrating(false);
    }
    showAuthGate(!state.hadAuthenticatedSession);
    setAuthStatus('auth_status_failed', 'error');
    refreshAccountUi();
  }
}

function bindUi() {
  const authButton = qs('authGoogleBtn');
  const migrationButton = qs('migrationContinueBtn');
  const signOutButton = qs('profileSignOutBtn');
  if (authButton) authButton.addEventListener('click', signInWithGoogle);
  if (migrationButton) migrationButton.addEventListener('click', signInWithGoogle);
  if (signOutButton) signOutButton.addEventListener('click', signOut);
  window.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') closeProfilePage();
  });
  window.addEventListener('pageshow', () => {
    void probeSessionOnResume();
  });
  window.addEventListener('focus', () => {
    void probeSessionOnResume();
  });
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) void probeSessionOnResume();
  });
}

function hookLocaleUpdates() {
  if (!window.I18N || !window.I18N.applyLocale || window.__accountLocaleHooked) return;
  window.__accountLocaleHooked = true;
  const originalApplyLocale = window.I18N.applyLocale.bind(window.I18N);
  window.I18N.applyLocale = function() {
    originalApplyLocale.call(this);
    refreshAccountUi();
  };
}

window.NanoAccountBridge = {
  getScopedUserId: () => (state.user && state.user.id ? state.user.id : null),
  queueTextPresetSync,
  queueDesignPresetSync,
  queueHistoryPersist,
  queueHistoryDelete,
};

async function init() {
  bindUi();
  hookLocaleUpdates();
  renderStaticCopy();
  showSessionCheckOverlay(true);
  setAuthBusy(true);
  setAuthStatus('auth_status_checking');

  try {
    const cfg = await requestJson(AUTH_CONFIG_ENDPOINT, { method: 'GET' });
    state.configured = !!cfg.configured;
    if (!state.configured || !cfg.url || !cfg.anonKey) {
      showSessionCheckOverlay(false);
      setAuthBusy(true);
      setAuthStatus('auth_status_missing_config', 'error');
      showAuthGate(true);
      refreshAccountUi();
      return;
    }

    state.client = createClient(cfg.url, cfg.anonKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
    });

    const session = await resolvePersistedSession({
      allowBackup: true,
      reason: 'init',
    });
    showSessionCheckOverlay(false);
    await handleSession(session);

    state.client.auth.onAuthStateChange((event, nextSession) => {
      queueMicrotask(() => {
        if ((event === 'TOKEN_REFRESHED' || event === 'USER_UPDATED' || event === 'SIGNED_IN') && isSameSignedInUser(nextSession) && (state.bootstrapComplete || state.bootNonce > 0)) {
          updateSessionIdentity(nextSession);
          return;
        }
        handleSession(nextSession).catch((error) => {
          console.error('auth state change failed', error);
        });
      });
    });
  } catch (error) {
    console.error('account init failed', error);
    showSessionCheckOverlay(false);
    setAuthBusy(true);
    setAuthStatus('auth_status_failed', 'error');
    showAuthGate(true);
  }
}

init();










