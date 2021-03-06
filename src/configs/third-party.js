/**
 * content config file
 * with proper config,
 * insert `call with ringcentral` button
 * or hover some elemet show call button tooltip
 * or convert phone number text to click-to-call link
 *
 */

import { thirdPartyConfigs } from 'ringcentral-embeddable-extension-common/src/common/app-config'
import { upgrade } from 'ringcentral-embeddable-extension-common/src/feat/upgrade-notification'
//* /

import _ from 'lodash'
import {
  showAuthBtn,
  unAuth,
  doAuth,
  notifyRCAuthed
} from '../features/auth'
import * as ls from 'ringcentral-embeddable-extension-common/src/common/ls'

import {
  showContactInfoPanel,
  getContacts,
  reSyncData
} from '../features/contacts'
import {
  getActivities,
  showActivityDetail
} from '../features/activities'
import { syncCallLogToThirdParty } from '../features/call-log-sync'
import {
  search,
  match
} from 'ringcentral-embeddable-extension-common/src/common/db'
import initReact from '../lib/react-entry'
import initInner from '../lib/inner-entry'
import initCallLog from '../lib/call-log-entry'
import { resyncCheck } from '../lib/auto-resync'
import copy from 'json-deep-copy'

let {
  pageSize = 100
} = thirdPartyConfigs

/**
 * thirdPartyService config
 * @param {*} serviceName
 */
export async function thirdPartyServiceConfig (serviceName) {
  console.log(serviceName, 'serviceName')

  let services = {
    name: serviceName,
    // // show contacts in ringcentral widgets
    contactsPath: '/contacts',
    contactIcon: 'https://github.com/ringcentral/pipedrive-embeddable-ringcentral-phone-spa/blob/master/src/pipedrive-logo.png?raw=true',
    contactSearchPath: '/contacts/search',
    contactMatchPath: '/contacts/match',

    // show auth/auauth button in ringcentral widgets
    authorizationPath: '/authorize',
    authorizedTitle: 'Unauthorize',
    unauthorizedTitle: 'Authorize',
    authorized: false,

    // Enable call log sync feature
    callLoggerPath: '/callLogger',
    callLoggerTitle: `Log to ${serviceName}`,

    messageLoggerPath: '/messageLogger',
    messageLoggerTitle: `Log to ${serviceName}`,

    // show contact activities in ringcentral widgets
    activitiesPath: '/activities',
    activityPath: '/activity',
    callLogEntityMatcherPath: '/callLogger/match',
    messageLogEntityMatcherPath: '/messageLogger/match'
  }

  // handle ringcentral event
  let handleRCEvents = async e => {
    // console.log(e)
    let { data } = e
    if (!data) {
      return
    }
    console.debug(data)
    let { type, loggedIn, path, call } = data
    if (type === 'rc-login-status-notify') {
      console.debug('rc logined', loggedIn)
      window.rc.rcLogined = loggedIn
    }
    if (
      type === 'rc-route-changed-notify' &&
      path === '/contacts' &&
      !window.rc.userAuthed
    ) {
      showAuthBtn()
    } else if (type === 'rc-call-end-notify') {
      const dd = copy(data)
      dd.type = 'rc-show-add-contact-panel'
      window.postMessage(dd, '*')
    } else if (
      type === 'rc-active-call-notify'
    ) {
      showContactInfoPanel(call)
    } else if (type === 'rc-region-settings-notify') {
      const prevCountryCode = window.rc.countryCode || 'US'
      console.log('prev country code:', prevCountryCode)
      const newCountryCode = data.countryCode
      console.log('new country code:', newCountryCode)
      if (prevCountryCode !== newCountryCode) {
        reSyncData()
      }
      window.rc.countryCode = newCountryCode
      ls.set('rc-country-code', newCountryCode)
    }
    if (type !== 'rc-post-message-request') {
      return
    }

    let { rc } = window

    if (data.path === '/authorize') {
      if (rc.userAuthed) {
        unAuth()
      } else {
        doAuth()
      }
      rc.postMessage({
        type: 'rc-post-message-response',
        responseId: data.requestId,
        response: { data: 'ok' }
      })
    } else if (path === '/contacts') {
      let isMannulSync = _.get(data, 'body.type') === 'manual'
      let page = _.get(data, 'body.page') || 1
      if (isMannulSync && page === 1) {
        window.postMessage({
          type: 'rc-show-sync-menu'
        }, '*')
        return rc.postMessage({
          type: 'rc-post-message-response',
          responseId: data.requestId,
          response: {
            data: []
          }
        })
      }
      window.postMessage({
        type: 'rc-transferring-data',
        transferringData: true
      }, '*')
      let contacts = await getContacts(page)
      window.postMessage({
        type: 'rc-transferring-data',
        transferringData: false
      }, '*')
      let nextPage = ((contacts.count || 0) - page * pageSize > 0) || contacts.hasMore
        ? page + 1
        : null
      rc.postMessage({
        type: 'rc-post-message-response',
        responseId: data.requestId,
        response: {
          data: contacts.result,
          nextPage,
          syncTimestamp: window.rc.syncTimestamp || null
        }
      })
    } else if (path === '/contacts/search') {
      if (!window.rc.userAuthed) {
        return showAuthBtn()
      }
      let contacts = []
      let keyword = _.get(data, 'body.searchString')
      if (keyword) {
        contacts = await search(keyword)
      }
      rc.postMessage({
        type: 'rc-post-message-response',
        responseId: data.requestId,
        response: {
          data: contacts
        }
      })
    } else if (path === '/contacts/match') {
      if (!window.rc.userAuthed) {
        return showAuthBtn()
      }
      let phoneNumbers = _.get(data, 'body.phoneNumbers') || []
      let res = await match(phoneNumbers).catch(console.debug)
      rc.postMessage({
        type: 'rc-post-message-response',
        responseId: data.requestId,
        response: {
          data: res
        }
      })
    } else if (path === '/callLogger' || path === '/messageLogger') {
      // add your codes here to log call to your service
      syncCallLogToThirdParty(data.body)
      // response to widget
      rc.postMessage({
        type: 'rc-post-message-response',
        responseId: data.requestId,
        response: { data: 'ok' }
      })
    } else if (path === '/activities') {
      const activities = await getActivities(data.body)
      /*
      [
        {
          id: '123',
          subject: 'Title',
          time: 1528854702472
        }
      ]
      */
      // response to widget
      rc.postMessage({
        type: 'rc-post-message-response',
        responseId: data.requestId,
        response: { data: activities }
      })
    } else if (path === '/activity') {
      // response to widget
      showActivityDetail(data.body)
      rc.postMessage({
        type: 'rc-post-message-response',
        responseId: data.requestId,
        response: { data: 'ok' }
      })
    }
  }
  return {
    services,
    handleRCEvents
  }
}

/**
 * init third party
 * could init dom insert etc here
 */
export async function initThirdParty () {
  window.rc.countryCode = await ls.get('rc-country-code') || undefined
  console.log('rc.countryCode:', window.rc.countryCode)
  let userAuthed = await ls.get('userAuthed') || false
  window.rc.userAuthed = userAuthed
  window.rc.syncTimestamp = await ls.get('syncTimestamp') || null
  if (window.rc.userAuthed) {
    notifyRCAuthed()
  }
  upgrade()
  initReact()
  initInner()
  initCallLog()
  resyncCheck()
}
