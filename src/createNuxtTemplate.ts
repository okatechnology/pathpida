import fs from 'fs'
import path from 'path'

const createMethods = (
  indent: string,
  importName: string | undefined,
  pathname: string,
  trailingSlash: boolean
) =>
  `${indent}  $url: (url${importName?.startsWith('Query') ? '' : '?'}: { ${
    importName ? `query${importName.startsWith('Optional') ? '?' : ''}: ${importName}, ` : ''
  }hash?: string }) => ({ path: ${/\${/.test(pathname) ? '`' : "'"}${pathname}${
    trailingSlash || pathname === '' ? '/' : ''
  }${/\${/.test(pathname) ? '`' : "'"}${
    importName ? `, query: url${importName.startsWith('Query') ? '' : '?'}.query as any` : ''
  }, hash: url${importName?.startsWith('Query') ? '' : '?'}.hash })`

export default (input: string, trailingSlash = false) => {
  const imports: string[] = []
  const getImportName = (file: string) => {
    const fileData = fs.readFileSync(file, 'utf8')
    const typeName = ['Query', 'OptionalQuery'].find(type =>
      new RegExp(`export (interface ${type} ?{|type ${type} ?= ?{)`).test(fileData)
    )

    if (typeName) {
      const queryRegExp = new RegExp(`export (interface ${typeName} ?{|type ${typeName} ?= ?{)`)
      const [, typeText, targetText] = fileData.split(queryRegExp)
      const { length } = targetText
      let cursor = 0
      let depth = 1

      while (depth && cursor <= length) {
        if (targetText[cursor] === '}') {
          depth -= 1
        } else if (targetText[cursor] === '{') {
          depth += 1
        }

        cursor += 1
      }

      const importName = `${typeName}${imports.length}`
      imports.push(
        `${typeText.replace(typeName, importName)}${targetText
          .slice(0, cursor)
          .replace(/\r/g, '')}\n`
      )
      return importName
    }
  }

  const createQueryString = (
    targetDir: string,
    importBasePath: string,
    indent: string,
    url: string,
    text: string,
    methodsOfIndexTsFile?: string
  ) => {
    const props: string[] = []

    indent += '  '

    fs.readdirSync(targetDir)
      .filter(file => !file.startsWith('-'))
      .sort()
      .forEach((file, _, arr) => {
        const basename = path.basename(file, path.extname(file))
        let valFn = `${indent}${basename
          .replace(/(-|\.|!| |'|\*|\(|\))/g, '_')
          .replace(/^(\d)/, '$$$1')}: {\n<% next %>\n${indent}}`
        let newUrl = `${url}/${basename}`

        if (basename.startsWith('_')) {
          const slug = basename.slice(1)
          valFn = `${indent}_${slug}: (${slug}: string | number) => ({\n<% next %>\n${indent}})`
          newUrl = `${url}/\${${slug}}`
        }

        const target = path.posix.join(targetDir, file)

        if (fs.statSync(target).isFile() && basename !== 'index' && !arr.includes(basename)) {
          props.push(
            valFn.replace(
              '<% next %>',
              createMethods(indent, getImportName(target), newUrl, trailingSlash)
            )
          )
        } else if (fs.statSync(target).isDirectory()) {
          const indexFile = fs
            .readdirSync(target)
            .find(name => path.basename(name, path.extname(name)) === 'index')
          let methods

          if (indexFile) {
            methods = createMethods(
              indent,
              getImportName(path.posix.join(target, indexFile)),
              newUrl,
              trailingSlash
            )
          }

          props.push(
            createQueryString(
              target,
              `${importBasePath}/${file}`,
              indent,
              newUrl,
              valFn.replace('<% next %>', '<% props %>'),
              methods
            )
          )
        }
      })

    return text.replace(
      '<% props %>',
      `${props.join(',\n')}${
        methodsOfIndexTsFile ? `${props.length ? ',\n' : ''}${methodsOfIndexTsFile}` : ''
      }`
    )
  }

  const rootIndexFile = fs
    .readdirSync(input)
    .find(name => path.basename(name, path.extname(name)) === 'index')
  const rootIndent = ''
  let rootMethods

  if (rootIndexFile) {
    rootMethods = createMethods(
      rootIndent,
      getImportName(path.posix.join(input, rootIndexFile)),
      '',
      trailingSlash
    )
  }

  const text = createQueryString(input, '.', rootIndent, '', `{\n<% props %>\n}`, rootMethods)

  return `/* eslint-disable */
import { Plugin } from '@nuxt/types'

${imports.join('\n')}${
    imports.length ? '\n' : ''
  }export const pagesPath = ${text}\n\nexport type PagesPath = typeof pagesPath
`
}
