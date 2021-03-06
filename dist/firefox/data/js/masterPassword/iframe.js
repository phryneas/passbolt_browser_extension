/**
 * Master password iframe control.
 *
 * It has for aim to control the master password dialog iframe.
 * 	- Add the iframe to the application page. The masterPasswordDialogPagemod
 * 	  will detect it and will control it.
 * 	- Close the iframe.
 *
 * @copyright (c) 2015-present Bolt Softwares Pvt Ltd
 * @licence GNU Affero General Public License http://www.gnu.org/licenses/agpl-3.0.en.html
 */

/*
 * Open the master password dialog.
 * @listens passbolt.master-password.open-dialog
 */
passbolt.message.on('passbolt.master-password.open-dialog', function () {
	var iframeUrl;
	var iframeId = 'passbolt-iframe-master-password';
	if(typeof chrome !== 'undefined') {
		iframeUrl = chrome.runtime.getURL('data/' + iframeId +'.html');
	} else {
		iframeUrl = 'about:blank';
	}
	iframeUrl += '?passbolt=' + iframeId;

	// Add the master password iframe to the application page.
	var $iframe = $('<iframe/>', {
		id: iframeId,
		src: iframeUrl,
		class: 'passbolt-plugin-dialog loading',
		frameBorder: 0
	});
	$iframe.appendTo('body');
});

/*
 * Close the master password dialog.
 * @listens passbolt.master-password.close-dialog
 */
passbolt.message.on('passbolt.master-password.close-dialog', function () {
	$('#passbolt-iframe-master-password').remove();
});
