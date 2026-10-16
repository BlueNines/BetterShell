/**
 * database default should init
 */

function parsor (themeTxt) {
  return themeTxt.split('\n').reduce((prev, line) => {
    let [key = '', value = ''] = line.split('=')
    key = key.trim()
    value = value.trim()
    if (!key || !value) {
      return prev
    }
    prev[key] = value
    return prev
  }, {})
}

const defaultThemeDark = () => {
  return parsor(`
main-dark=#000
main-light=#2E3338
text=#ddd
text-light=#fff
text-dark=#888
text-disabled=#777
primary=#08c
info=#FFD166
success=#06D6A0
error=#EF476F
warn=#E55934
main=#121214
  `)
}
const defaultThemeLightFunc = () => {
  return parsor(`
      main=#ededed
      main-dark=#cccccc
      main-light=#fefefe
      text=#555
      text-light=#777
      text-dark=#444
      text-disabled=#888
      primary=#08c
      info=#FFD166
      success=#06D6A0
      error=#EF476F
      warn=#E55934
    `)
}

const defaultThemeDarkTerminal = () => {
  return {
    foreground: '#d5deea',
    background: '#17212e',
    cursor: '#94b8ed',
    cursorAccent: '#1d1f21',
    selectionBackground: 'rgba(200, 200, 200, 0.6)',
    black: '#575757',
    red: '#FF2C6D',
    green: '#19f9d8',
    yellow: '#FFB86C',
    blue: '#45A9F9',
    magenta: '#FF75B5',
    cyan: '#B084EB',
    white: '#CDCDCD',
    brightBlack: '#757575',
    brightRed: '#FF2C6D',
    brightGreen: '#19f9d8',
    brightYellow: '#FFCC95',
    brightBlue: '#6FC1FF',
    brightMagenta: '#FF9AC1',
    brightCyan: '#BCAAFE',
    brightWhite: '#E6E6E6'
  }
}

export const defaultThemeId = 'default'
export const defaultThemeLightId = 'defaultLight'

export function defaultTheme () {
  return {
    id: defaultThemeId,
    name: 'default',
    themeConfig: defaultThemeDarkTerminal(),
    uiThemeConfig: defaultThemeDark()
  }
}

export function defaultThemeLight () {
  return {
    id: defaultThemeLightId,
    name: 'default light',
    themeConfig: { ...defaultThemeDarkTerminal(), background: '#f8fafc', foreground: '#334155', cursor: '#3976d2', selectionBackground: '#dce8f8' },
    uiThemeConfig: defaultThemeLightFunc()
  }
}
