import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { useMatch } from 'react-router-dom'

export function useTitle(title?: string) {
  const { t } = useTranslation('ui')
  const match = useMatch({ path: '/:page/*' })
  const pageTitle = t('pageTitle')
  // the home page's title is what search results show for the site, so it says what the app is
  const homeTitle = t('homeTitle', { defaultValue: pageTitle })
  const displayTitle =
    title ?? (match?.params.page && t(`tabs.${match?.params.page}`))
  useEffect(() => {
    if (displayTitle) document.title = `${displayTitle} - ${pageTitle}`
    else document.title = homeTitle
  }, [t, pageTitle, homeTitle, displayTitle])
}
