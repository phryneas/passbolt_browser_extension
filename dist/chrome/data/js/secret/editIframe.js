/**
 * Secret edition/creation iframe control.
 *
 * It has for aim to control the secret edition/creation dialog iframe.
 *  - Add the iframe to the application page. The secretEditDialogPagemod
 *    will detect it and will control its DOM.
 *
 * @copyright (c) 2015-present Bolt Softwares Pvt Ltd
 * @licence GNU Affero General Public License http://www.gnu.org/licenses/agpl-3.0.en.html
 */

(function () {

  /**
   * Insert the secret edition/creation iframe into the edit password dialog
   * provided by the application page.
   *
   * @param dialogCase {string} The case the component will be instantiated for.
   *  Can be create or edit.
   */
  var _insertIframe = function (dialogCase) {
    var $iframe = $('<iframe/>', {
      id: 'passbolt-iframe-secret-edition',
      src: 'about:blank?passbolt=secretEdit&case=' + dialogCase,
      class: 'loading',
      frameBorder: 0
    });
    $iframe.appendTo('.js_form_secret_wrapper');
  };

  /*
   * Open the secret field control component when a password is created or edited.
   * @listens passbolt.plugin.resource_edition
   */
  window.addEventListener("passbolt.plugin.resource_edition", function () {
    var editData = {
        armored: null,
        resourceId: null,
        secret: ''
      },
      dialogCase = 'create';

    // If a secret id is given that mean we're editing a password.
    if ($('#js_field_secret_id_0').val() != '') {
      dialogCase = 'edit';
      editData.resourceId = $('#js_field_resource_id').val();
      editData.armored = $('#js_field_secret_data_0').val();
      editData.secret = null;
    }

    passbolt.request('passbolt.edit-password.set-edited-password', editData)
      .then(function () {
        _insertIframe(dialogCase);
      });
  }, false);

})();
