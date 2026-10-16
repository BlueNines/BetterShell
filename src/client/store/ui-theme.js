// 深浅主题共享 CSS 变量，让文件列表、编辑器和浮层使用一致的颜色。
export default function personalUiTheme (Store) {
  // 没有历史界面主题设置时，个人版默认使用深色。
  Store.prototype.getUiThemeConfig = function () {
    const dark = this.config.personalUiMode !== 'light'
    return dark
      ? { main: '#151c27', 'main-dark': '#101620', 'main-light': '#1b2432', text: '#c7d2e2', 'text-light': '#f0f5fc', 'text-dark': '#8b9bb1', 'text-disabled': '#5a697c', primary: '#263d5e', info: '#7daaff', success: '#5dc9a0', error: '#ed8792', warn: '#eab76a', 'personal-bg': '#101620', 'personal-surface': '#151c27', 'personal-card': '#1b2432', 'personal-border': '#293548', 'personal-hover': '#243349', 'personal-accent': '#7daaff', 'personal-purple': '#b5a1f2' }
      : { main: '#ffffff', 'main-dark': '#e7edf4', 'main-light': '#f7f9fc', text: '#334155', 'text-light': '#172b45', 'text-dark': '#6e7e94', 'text-disabled': '#a4afbd', primary: '#e5effd', info: '#3976d2', success: '#258c68', error: '#bd5361', warn: '#b0823d', 'personal-bg': '#f0f3f8', 'personal-surface': '#ffffff', 'personal-card': '#f7f9fc', 'personal-border': '#e0e6ef', 'personal-hover': '#eaf1fc', 'personal-accent': '#3976d2', 'personal-purple': '#8060c9' }
  }
}
